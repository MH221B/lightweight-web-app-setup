import { mkdir, readFile, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import {
  findLeftovers,
  humanize,
  renameProject,
  validateProjectName,
  type Flavor,
} from "./rename.ts";

const DEFAULT_TEMPLATES_DIR = fileURLToPath(new URL("../templates", import.meta.url));
const DOTFILES: Record<string, string> = {
  _gitattributes: ".gitattributes",
  _gitignore: ".gitignore",
  _npmrc: ".npmrc",
};

export type SchemaLib = "zod" | "effect";
export type DbEngine = "sqlite" | "postgres";

export interface ScaffoldOptions {
  flavor: Flavor;
  projectName: string;
  targetDir: string;
  templatesDir?: string;
  schema: SchemaLib;
  db: DbEngine;
}

export interface ScaffoldResult {
  targetDir: string;
  projectName: string;
  displayName: string;
  flavor: Flavor;
  schema: SchemaLib;
  db: DbEngine;
  skipped: string[];
  removed: string[];
}

export function overlaySetFor(schema: SchemaLib, db: DbEngine): string | null {
  if (db === "postgres") return schema === "effect" ? "effect-postgres" : "zod-postgres";
  return schema === "effect" ? "effect-sqlite" : null;
}

export function templatesRoot(): string {
  return resolve(process.env.MH_STACK_TEMPLATES_DIR ?? DEFAULT_TEMPLATES_DIR);
}

function mappedName(name: string): string {
  return DOTFILES[name] ?? name;
}

async function copyTree(
  source: string,
  destination: string,
  written: string[],
  skipped: string[],
  base = "",
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const name = mappedName(entry.name);
    const to = join(destination, name);
    const path = base === "" ? name : `${base}/${name}`;
    if (entry.isDirectory()) {
      await copyTree(from, to, written, skipped, path);
    } else if (entry.isFile()) {
      await mkdir(dirname(to), { recursive: true });
      try {
        // "wx" fails instead of truncating: a merge never destroys a user file.
        await writeFile(to, await readFile(from), { flag: "wx" });
        written.push(path);
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        skipped.push(path);
      }
    }
  }
}

async function copyOverlayTree(
  source: string,
  destination: string,
  written: string[],
  skipped: string[],
  base = "",
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const name = mappedName(entry.name);
    const to = join(destination, name);
    const path = base === "" ? name : `${base}/${name}`;
    if (entry.isDirectory()) {
      await copyOverlayTree(from, to, written, skipped, path);
    } else if (entry.isFile()) {
      if (path === "removals.json") continue;
      await mkdir(dirname(to), { recursive: true });
      const data = await readFile(from);
      if (written.includes(path)) {
        // The base tree wrote this path, so the overlay replaces it.
        await writeFile(to, data);
        continue;
      }
      // The tree never wrote it (the user owned it, or the merge skipped it):
      // create exclusively so a user file is never destroyed.
      try {
        await writeFile(to, data, { flag: "wx" });
        written.push(path);
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        if (!skipped.includes(path)) skipped.push(path);
      }
    }
  }
}

async function applyRemovals(
  overlayDir: string,
  targetDir: string,
  written: string[],
): Promise<string[]> {
  const file = join(overlayDir, "removals.json");
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return [];

  const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`Invalid removals.json in ${overlayDir}`);
  }

  const removed: string[] = [];
  const prunable = new Set<string>();
  for (const entry of parsed as string[]) {
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

  const targetDir = resolve(options.targetDir);
  await mkdir(targetDir, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  await copyTree(templateDir, targetDir, written, skipped);

  let removed: string[] = [];
  const set = overlaySetFor(options.schema, options.db);
  if (set !== null) {
    const overlayDir = join(dirname(templatesDir), "overlays", options.flavor, set);
    const overlayInfo = await stat(overlayDir).catch(() => null);
    if (!overlayInfo?.isDirectory()) {
      throw new Error(
        `Missing overlay "${set}" for "${options.flavor}" at ${overlayDir}. Run "bun run templates:sync".`,
      );
    }
    // Removals first: the pg set then writes its own drizzle.config.ts over the freed path.
    removed = await applyRemovals(overlayDir, targetDir, written);
    await copyOverlayTree(overlayDir, targetDir, written, skipped);
  }

  for (const path of skipped) {
    console.log(`${styleText("yellow", "!")} skipped existing file: ${path}`);
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
    skipped: skipped,
    removed: removed,
  };
}
