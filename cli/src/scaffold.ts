import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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

export interface ScaffoldOptions {
  flavor: Flavor;
  projectName: string;
  targetDir: string;
  templatesDir?: string;
  schema: SchemaLib;
}

export interface ScaffoldResult {
  targetDir: string;
  projectName: string;
  displayName: string;
  flavor: Flavor;
  schema: SchemaLib;
  skipped: string[];
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

  if (options.schema === "effect") {
    const overlayDir = join(dirname(templatesDir), "overlays", options.flavor);
    const overlayInfo = await stat(overlayDir).catch(() => null);
    if (!overlayInfo?.isDirectory()) {
      throw new Error(
        `Missing effect overlay for "${options.flavor}" at ${overlayDir}. Run "bun run templates:sync".`,
      );
    }
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
    skipped: skipped,
  };
}
