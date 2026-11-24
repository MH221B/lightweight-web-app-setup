import { mkdir, readFile, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOTFILES,
  STYLE_OVERLAYS,
  overlaySetFor,
  type DbEngine,
  type SchemaLib,
  type StyleChoice,
} from "./template-config.ts";
export type { DbEngine, SchemaLib, StyleChoice } from "./template-config.ts";
import {
  findLeftovers,
  humanize,
  renameProject,
  validateProjectName,
  type Flavor,
} from "./rename.ts";

const DEFAULT_TEMPLATES_DIR = fileURLToPath(new URL("../templates", import.meta.url));
const DOTFILE_NAMES = Object.fromEntries(
  Object.entries(DOTFILES).map(([name, mapped]) => [mapped, name]),
);

export const COMBOS = (["react", "angular"] as const).flatMap((flavor) =>
  (["zod", "effect"] as const).flatMap((schema) =>
    (["sqlite", "postgres"] as const).flatMap((db) =>
      (["scss", "tailwind", "both"] as const).map((style) => ({ flavor, schema, db, style })),
    ),
  ),
);

// The heavy CI workflows run this sample: every flavor and schema and database
// with the default style, plus both Tailwind styles on the cheapest quad. The
// full 24-case COMBOS oracle still runs in `bun run test:cli`.
export const CI_COMBOS = (["react", "angular"] as const).flatMap((flavor) => [
  ...(["zod", "effect"] as const).flatMap((schema) =>
    (["sqlite", "postgres"] as const).map((db) => ({
      flavor,
      schema,
      db,
      style: "scss" as const,
    })),
  ),
  ...(["tailwind", "both"] as const).map((style) => ({
    flavor,
    schema: "zod" as const,
    db: "sqlite" as const,
    style,
  })),
]);

export interface ScaffoldOptions {
  flavor: Flavor;
  projectName: string;
  targetDir: string;
  templatesDir?: string;
  schema: SchemaLib;
  db: DbEngine;
  style?: StyleChoice;
}

export interface ScaffoldResult {
  targetDir: string;
  projectName: string;
  displayName: string;
  flavor: Flavor;
  schema: SchemaLib;
  db: DbEngine;
  style: StyleChoice;
  skipped: string[];
  removed: string[];
}

export function templatesRoot(): string {
  return resolve(process.env.LWAPP_TEMPLATES_DIR ?? DEFAULT_TEMPLATES_DIR);
}

function mappedName(name: string): string {
  return DOTFILE_NAMES[name] ?? name;
}

async function copyTree(
  source: string,
  destination: string,
  written: string[],
  skipped: string[],
  overlay = false,
  base = "",
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const name = mappedName(entry.name);
    const to = join(destination, name);
    const path = base === "" ? name : `${base}/${name}`;
    if (entry.isDirectory()) {
      await copyTree(from, to, written, skipped, overlay, path);
    } else if (entry.isFile()) {
      if (overlay && path === "removals.json") continue;
      await mkdir(dirname(to), { recursive: true });
      const data = await readFile(from);
      if (overlay && written.includes(path)) {
        await writeFile(to, data);
        continue;
      }
      try {
        // "wx" fails instead of truncating: a merge never destroys a user file.
        await writeFile(to, data, { flag: "wx" });
        written.push(path);
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        if (overlay) throw new Error(`Overlay conflicts with an existing file: ${path}`);
        skipped.push(path);
      }
    } else throw new Error(`Unsupported template entry: ${from}`);
  }
}

async function readRemovals(overlayDir: string): Promise<string[]> {
  const file = join(overlayDir, "removals.json");
  const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return [];
  if (!info.isFile()) throw new Error(`Invalid removals.json in ${overlayDir}`);
  const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`Invalid removals.json in ${overlayDir}`);
  }
  return parsed as string[];
}

async function applyRemovals(
  parsed: string[],
  targetDir: string,
  written: string[],
): Promise<string[]> {
  const removed: string[] = [];
  const prunable = new Set<string>();
  for (const entry of parsed) {
    const directory = entry.endsWith("/");
    const path = directory ? entry.slice(0, -1) : entry;
    const targets = written.filter(
      (item) => item === path || (directory && item.startsWith(`${path}/`)),
    );
    if (targets.length === 0) continue; // never written here: the user owns it
    for (const target of targets) {
      await rm(join(targetDir, target), { force: true });
      // Remember the declared directory and its empty descendants, deepest
      // first later; `server/drizzle/meta/` would otherwise keep
      // `server/drizzle/` alive. Never climb above the declared path, and
      // never prune for a plain file entry.
      if (!directory) continue;
      for (let dir = parentPath(target); dir !== ""; dir = parentPath(dir)) {
        prunable.add(dir);
        if (dir === path) break;
      }
    }
    const dropped = new Set(targets);
    for (let index = written.length - 1; index >= 0; index -= 1) {
      const current = written[index];
      if (current !== undefined && dropped.has(current)) written.splice(index, 1);
    }
    removed.push(entry);
  }

  // Deepest first, and rmdir only: a directory that still holds a user file
  // (or any other scaffold file) throws ENOTEMPTY, which is swallowed, so
  // user-owned content always survives.
  for (const dir of [...prunable].sort((a, b) => b.split("/").length - a.split("/").length)) {
    await rmdir(join(targetDir, dir)).catch(() => {});
  }
  return removed;
}

// `written` paths are "/"-separated on every platform (copyTree builds them
// that way). Use a POSIX parent rather than node:path's platform-specific
// dirname, so the `dir === path` boundary and the depth sort compare the
// exact strings that were recorded.
function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const style = options.style ?? "scss";
  if (
    !COMBOS.some(
      ({ flavor, schema, db, style: candidate }) =>
        flavor === options.flavor &&
        schema === options.schema &&
        db === options.db &&
        candidate === style,
    )
  )
    throw new Error("Unsupported scaffold combination");
  const invalid = validateProjectName(options.projectName);
  if (invalid) throw new Error(invalid);

  const templatesDir = resolve(options.templatesDir ?? templatesRoot());
  const templateDir = join(templatesDir, options.flavor);
  const templateInfo = await stat(templateDir).catch(() => null);
  if (!templateInfo?.isDirectory()) {
    throw new Error(
      `Missing template for "${options.flavor}" at ${templateDir}. Run "bun run templates:sync".`,
    );
  }

  const set = overlaySetFor(options.schema, options.db);
  const styleOverlay = STYLE_OVERLAYS[style];
  const overlaySets: string[] = [];
  if (set !== null) overlaySets.push(set);
  if (styleOverlay !== null) overlaySets.push(styleOverlay);
  const overlays: Array<{ dir: string; removals: string[] }> = [];
  for (const overlaySet of overlaySets) {
    const overlayDir = join(dirname(templatesDir), "overlays", options.flavor, overlaySet);
    const overlayInfo = await stat(overlayDir).catch(() => null);
    if (!overlayInfo?.isDirectory()) {
      throw new Error(
        `Missing overlay "${overlaySet}" for "${options.flavor}" at ${overlayDir}. Run "bun run templates:sync".`,
      );
    }
    overlays.push({ dir: overlayDir, removals: await readRemovals(overlayDir) });
  }
  const targetDir = resolve(options.targetDir);
  if (set === null) {
    for (const path of ["server/src/env.ts", "shared/notes.contract.ts"]) {
      const existing = await stat(join(targetDir, path)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing) throw new Error(`Cannot determine existing scaffold variant: ${path}`);
    }
  }
  await mkdir(targetDir, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  await copyTree(templateDir, targetDir, written, skipped);

  const removed: string[] = [];
  for (const overlay of overlays) {
    // Removals first: each overlay frees its own paths before writing.
    removed.push(...(await applyRemovals(overlay.removals, targetDir, written)));
    await copyTree(overlay.dir, targetDir, written, skipped, true);
  }

  const displayName = humanize(options.projectName);
  const spans = await renameProject({
    targetDir,
    projectName: options.projectName,
    displayName,
    flavor: options.flavor,
    skipped: new Set(skipped),
  });

  // Scan only what the scaffold wrote: a skipped path belongs to the user and
  // may legitimately mention starter terms.
  const leftovers = await findLeftovers(
    targetDir,
    options.flavor,
    options.projectName,
    written,
    spans,
  );
  if (leftovers.length > 0) {
    throw new Error(`Leftover starter names after rename:\n  ${leftovers.join("\n  ")}`);
  }

  return {
    targetDir,
    projectName: options.projectName,
    displayName,
    flavor: options.flavor,
    schema: options.schema,
    db: options.db,
    style: style,
    skipped: skipped,
    removed: removed,
  };
}
