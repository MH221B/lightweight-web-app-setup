import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function walkFiles(
  dir: string,
  base = "",
  exclude: (path: string, isDirectory: boolean) => boolean = () => false,
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = base ? `${base}/${entry.name}` : entry.name;
    if (exclude(path, entry.isDirectory())) continue;
    if (entry.isDirectory()) files.push(...(await walkFiles(join(dir, entry.name), path, exclude)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported directory entry: ${join(dir, entry.name)}`);
  }
  return files;
}
