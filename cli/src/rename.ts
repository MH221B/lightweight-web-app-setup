import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export type Flavor = "react" | "angular";
export type WrittenSpans = Map<string, Array<[number, number]>>;

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  overrides?: Record<string, string>;
  [key: string]: unknown;
}

interface AngularJson {
  projects?: Record<string, AngularProject>;
  [key: string]: unknown;
}

interface AngularProject {
  prefix?: string;
  architect?: {
    serve?: { configurations?: Record<string, { buildTarget?: string }> };
  };
  [key: string]: unknown;
}

const CLIENT_DIR: Record<Flavor, string> = {
  react: "client",
  angular: "client-angular",
};

export function validateProjectName(name: string): string | null {
  if (name.length === 0) return "Project name is required.";
  if (name.length > 214) return "Project name must be 214 characters or fewer.";
  if (`${name}-client`.length > 214) {
    return `Project name is too long: "${name}-client" exceeds npm's 214-character package name limit.`;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return "Use lowercase letters, digits, and hyphens only, starting with a letter or digit.";
  }
  if (name === "node_modules" || name === "favicon.ico") return `"${name}" is reserved.`;
  return null;
}

export function humanize(projectName: string): string {
  return projectName
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function selectorPrefix(projectName: string): string {
  const prefix = projectName.replace(/^[^a-z]+/, "");
  return prefix.length > 0 ? prefix : "app";
}

export function clientPackageName(projectName: string): string {
  return `${projectName}-client`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function editText(
  file: string,
  edits: Array<[find: string, replacement: string]>,
): Promise<Array<[number, number]>> {
  let text = await readFile(file, "utf8");
  const spans: Array<[number, number]> = [];
  for (const [find, replacement] of edits) {
    const at = text.indexOf(find);
    if (at < 0) {
      throw new Error(`${relative(process.cwd(), file)}: expected to find ${JSON.stringify(find)}`);
    }
    const delta = replacement.length - find.length;
    for (const span of spans) {
      if (span[0] >= at + find.length) {
        span[0] += delta;
        span[1] += delta;
      }
    }
    text = text.slice(0, at) + replacement + text.slice(at + find.length);
    spans.push([at, at + replacement.length]);
  }
  await writeFile(file, text);
  return spans;
}

function renameFilters(scripts: Record<string, string>, from: string, to: string): void {
  const pattern = new RegExp(`${escapeRegExp(from)}(?=\\s|$|")`, "g");
  for (const [key, value] of Object.entries(scripts)) {
    scripts[key] = value.replace(pattern, to);
  }
}

function rewriteProjectReferences(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") return value.replaceAll(`${from}:`, `${to}:`);
  if (Array.isArray(value)) return value.map((item) => rewriteProjectReferences(item, from, to));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = rewriteProjectReferences(record[key], from, to);
    }
  }
  return value;
}

async function listFiles(dir: string, base = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = base === "" ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listFiles(join(dir, entry.name), path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function occurrences(text: string, token: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let index = text.indexOf(token);
  while (index >= 0) {
    spans.push([index, index + token.length]);
    index = text.indexOf(token, index + 1);
  }
  return spans;
}

export async function findLeftovers(
  targetDir: string,
  flavor: Flavor,
  projectName: string,
  files?: string[],
  writtenSpans: WrittenSpans = new Map(),
): Promise<string[]> {
  const forbidden = [
    "lightweight-web-app-starter",
    "Lightweight web app",
    'selector: "app-root"',
    "<app-root",
    "</app-root>",
    'prefix: "app"',
    ...(flavor === "react"
      ? ["client-angular", "@angular/"]
      : ["@client/", "routeTree.gen.ts", "--filter client "]),
  ];
  const hits: string[] = [];
  for (const file of files ?? (await listFiles(targetDir))) {
    const text = await readFile(join(targetDir, file), "utf8");
    const used = writtenSpans.get(file) ?? [];
    for (const token of forbidden) {
      const isIntended = occurrences(text, token).every(([start, end]) =>
        used.some(([from, to]) => start >= from && end <= to),
      );
      if (!isIntended) hits.push(`${file}: ${token}`);
    }
  }
  return hits;
}

interface RenameOptions {
  targetDir: string;
  projectName: string;
  displayName: string;
  flavor: Flavor;
  skipped: Set<string>;
}

export async function renameProject(options: RenameOptions): Promise<WrittenSpans> {
  const { targetDir, projectName, displayName, flavor, skipped } = options;
  const clientDir = CLIENT_DIR[flavor];
  const clientPkg = clientPackageName(projectName);
  const prefix = selectorPrefix(projectName);
  const filterFrom = flavor === "react" ? "--filter client" : "--filter client-angular";
  const spans: WrittenSpans = new Map();

  // A skipped path is a file the user already owned when the merge started.
  // Copying left it alone; every rename edit must respect that too.
  const edit = async (path: string, edits: Array<[string, string]>): Promise<void> => {
    if (skipped.has(path)) return;
    spans.set(path, await editText(join(targetDir, path), edits));
  };

  const rootPkgPath = join(targetDir, "package.json");
  if (!skipped.has("package.json")) {
    const rootPkg = await readJson<PackageJson>(rootPkgPath);
    if (!rootPkg.scripts) throw new Error("root package.json: missing scripts");
    rootPkg.name = projectName;
    renameFilters(rootPkg.scripts, filterFrom, `--filter ${clientPkg}`);
    await writeJson(rootPkgPath, rootPkg);
  }

  const clientPkgPath = join(targetDir, clientDir, "package.json");
  if (!skipped.has(`${clientDir}/package.json`)) {
    const clientPkgJson = await readJson<PackageJson>(clientPkgPath);
    clientPkgJson.name = clientPkg;
    await writeJson(clientPkgPath, clientPkgJson);
  }

  if (flavor === "angular") {
    if (!skipped.has(`${clientDir}/angular.json`)) {
      const angularJsonPath = join(targetDir, clientDir, "angular.json");
      const angularJson = await readJson<AngularJson>(angularJsonPath);
      const projects = angularJson.projects;
      const project = projects?.[clientDir];
      if (!projects || !project) throw new Error("angular.json: missing projects.client-angular");
      const renamed: Record<string, AngularProject> = {};
      for (const [key, value] of Object.entries(projects)) {
        renamed[key === clientDir ? clientPkg : key] =
          key === clientDir ? { ...value, prefix } : value;
      }
      angularJson.projects = renamed;
      const updated = rewriteProjectReferences(angularJson, clientDir, clientPkg) as AngularJson;
      await writeJson(angularJsonPath, updated);
    }

    await edit(`${clientDir}/eslint.config.mjs`, [
      ['prefix: "app", style: "kebab-case"', `prefix: "${prefix}", style: "kebab-case"`],
      ['prefix: "app", style: "camelCase"', `prefix: "${prefix}", style: "camelCase"`],
    ]);
    await edit(`${clientDir}/src/app/app.ts`, [
      ['selector: "app-root"', `selector: "${prefix}-root"`],
      ["<h1>Lightweight web app</h1>", `<h1>${displayName}</h1>`],
    ]);
    await edit(`${clientDir}/src/index.html`, [
      ["<app-root></app-root>", `<${prefix}-root></${prefix}-root>`],
      ["<title>Lightweight web app</title>", `<title>${displayName}</title>`],
    ]);
  } else {
    await edit(`${clientDir}/index.html`, [
      ["<title>Lightweight web app</title>", `<title>${displayName}</title>`],
    ]);
    await edit(`${clientDir}/src/routes/__root.tsx`, [
      ["<h1>Lightweight web app</h1>", `<h1>${displayName}</h1>`],
    ]);
  }

  if (!skipped.has("README.md")) {
    const readmePath = join(targetDir, "README.md");
    let readme = await readFile(readmePath, "utf8");
    if (!readme.startsWith("# Lightweight web app starter\n")) {
      throw new Error("README.md: expected the starter title on the first line");
    }
    const edits: Array<[string, string]> = [
      ["# Lightweight web app starter\n", `# ${displayName}\n`],
    ];
    for (const _ of occurrences(readme, `${filterFrom} `)) {
      edits.push([`${filterFrom} `, `--filter ${clientPkg} `]);
    }
    spans.set("README.md", await editText(readmePath, edits));
  }
  // JSON is rewritten structurally. Record only the fields that were changed.
  for (const path of [
    "package.json",
    `${clientDir}/package.json`,
    ...(flavor === "angular" ? [`${clientDir}/angular.json`] : []),
  ]) {
    if (skipped.has(path)) continue;
    const text = await readFile(join(targetDir, path), "utf8");
    const values =
      path === "package.json"
        ? [`"name": ${JSON.stringify(projectName)}`, `--filter ${clientPkg}`]
        : path.endsWith("/package.json")
          ? [`"name": ${JSON.stringify(clientPkg)}`]
          : [JSON.stringify(clientPkg), `${clientPkg}:`, `"prefix": ${JSON.stringify(prefix)}`];
    spans.set(
      path,
      values.flatMap((value) => occurrences(text, value)),
    );
  }
  return spans;
}
