import { afterAll, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { link, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap, quotePath } from "../src/bootstrap.ts";
import { findLeftovers, type Flavor } from "../src/rename.ts";
import { scaffold, templatesRoot, type SchemaLib } from "../src/scaffold.ts";

interface PackageJson {
  name?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
  overrides?: Record<string, string>;
  dependencies?: Record<string, string>;
}

interface AngularJson {
  projects?: Record<string, AngularProject>;
}

interface AngularProject {
  prefix?: string;
  architect?: {
    serve?: { configurations?: Record<string, { buildTarget?: string }> };
  };
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_ENTRY = process.env.MH_STACK_CLI_ENTRY ?? join(REPO_ROOT, "cli", "dist", "index.js");
const PROJECT = "acme-notes";
const DISPLAY = "Acme Notes";
const CLIENT_PACKAGE = `${PROJECT}-client`;
const created: string[] = [];
const version = (
  JSON.parse(await readFile(join(REPO_ROOT, "cli", "package.json"), "utf8")) as { version: string }
).version;

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function makeTarget(flavor: Flavor, name = PROJECT): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `mh-stack-${flavor}-`));
  created.push(root);
  return join(root, name);
}

async function walk(dir: string, base = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = base === "" ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walk(join(dir, entry.name), path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function assertScaffold(
  flavor: Flavor,
  dir: string,
  schema: SchemaLib = "zod",
): Promise<void> {
  const sharedPkg = await readJson<PackageJson>(join(dir, "shared", "package.json"));
  const serverPkg = await readJson<PackageJson>(join(dir, "server", "package.json"));
  const contract = await readFile(join(dir, "shared", "notes.contract.ts"), "utf8");
  const env = await readFile(join(dir, "server", "src", "env.ts"), "utf8");
  const envTest = await readFile(join(dir, "server", "test", "env.test.ts"), "utf8");
  const contractTest = await readFile(join(dir, "server", "test", "contract.test.ts"), "utf8");

  expect(envTest).toContain('from "@server/env"');
  expect(contractTest).toContain('from "@shared/notes.contract"');
  expect(envTest).not.toContain("variants/effect");
  expect(contractTest).not.toContain("variants/effect");
  expect((await stat(join(dir, "server", "test", "env.cases.ts"))).isFile()).toBe(true);
  expect((await stat(join(dir, "server", "test", "contract.cases.ts"))).isFile()).toBe(true);
  expect(
    await stat(join(dir, "server", "test", "env-effect.test.ts")).catch(() => null),
  ).toBeNull();
  expect(
    await stat(join(dir, "server", "test", "contract-effect.test.ts")).catch(() => null),
  ).toBeNull();
  expect(await stat(join(dir, "shared", "variants")).catch(() => null)).toBeNull();
  expect(await stat(join(dir, "server", "src", "variants")).catch(() => null)).toBeNull();
  expect(env).toContain('resolve(import.meta.dir, "../..")');
  expect(env).not.toContain('"../../../.."');

  if (schema === "zod") {
    expect(sharedPkg.dependencies).toEqual({
      "@orpc/client": "1.16.2",
      "@orpc/contract": "1.16.2",
      "@orpc/openapi-client": "1.16.2",
      zod: "3",
    });
    expect(serverPkg.dependencies?.zod).toBe("3");
    expect(serverPkg.dependencies?.effect).toBe("4.1.0");
    expect(contract).toContain('import { z } from "zod";');
    expect(env).toContain('import { z } from "zod";');
  } else {
    expect(sharedPkg.dependencies).toEqual({
      "@orpc/client": "1.16.2",
      "@orpc/contract": "1.16.2",
      "@orpc/openapi-client": "1.16.2",
      effect: "4.1.0",
    });
    expect(serverPkg.dependencies?.zod).toBeUndefined();
    expect(serverPkg.dependencies?.effect).toBe("4.1.0");
    expect(contract).toContain('import { Schema, SchemaTransformation } from "effect";');
    expect(env).toContain('import { Effect, Schema } from "effect";');
    expect(contractTest).toContain("standardCheck");
  }

  const chosen = flavor === "react" ? "client" : "client-angular";
  const other = flavor === "react" ? "client-angular" : "client";

  expect((await stat(join(dir, chosen))).isDirectory()).toBe(true);
  expect(await stat(join(dir, other)).catch(() => null)).toBeNull();

  const pkg = await readJson<PackageJson>(join(dir, "package.json"));
  expect(pkg.name).toBe(PROJECT);
  expect(pkg.workspaces).toEqual(
    flavor === "react" ? ["client", "server", "shared"] : ["client-angular", "server", "shared"],
  );
  expect(pkg.scripts?.test).toBe("bun run --filter server test");
  expect(pkg.scripts?.["templates:sync"]).toBeUndefined();
  expect(pkg.scripts?.["test:cli"]).toBeUndefined();

  const clientPkg = await readJson<PackageJson>(join(dir, chosen, "package.json"));
  expect(clientPkg.name).toBe(CLIENT_PACKAGE);

  const filters = Object.entries(pkg.scripts ?? {}).flatMap(([key, value]) =>
    [...value.matchAll(/--filter\s+(\S+)/g)].map((match) => ({ key, target: match[1] })),
  );
  expect(filters.length).toBeGreaterThan(0);
  expect([...new Set(filters.map(({ target }) => target))].sort()).toEqual(
    ["server", CLIENT_PACKAGE].sort(),
  );

  if (flavor === "react") {
    expect(pkg.scripts?.dev).toBe("bun run --parallel dev:client dev:server");
    expect(pkg.scripts?.["dev:client"]).toBe(`bun run --filter ${CLIENT_PACKAGE} dev`);
    expect(pkg.scripts?.build).toBe(`bun run --filter ${CLIENT_PACKAGE} build`);
    expect(pkg.scripts?.check).toBe("bun run routes && vp check");
    expect(pkg.scripts?.["dev:angular"]).toBeUndefined();
    expect(pkg.overrides?.["@angular/build>vite"]).toBeUndefined();
  } else {
    expect(pkg.scripts?.dev).toBeUndefined();
    expect(pkg.scripts?.routes).toBeUndefined();
    expect(pkg.scripts?.build).toBe(`bun run --filter ${CLIENT_PACKAGE} build`);
    expect(pkg.scripts?.["dev:angular-client"]).toBe(`bun run --filter ${CLIENT_PACKAGE} start`);
    expect(pkg.scripts?.check).toBe(`vp check && bun run --filter ${CLIENT_PACKAGE} lint`);
    expect(pkg.scripts?.typecheck).toBe("vp check --no-fmt --no-lint");
  }

  const vite = await readFile(join(dir, "vite.config.ts"), "utf8");
  if (flavor === "react") {
    expect(vite).toContain("client/dist/**");
    expect(vite).not.toContain("client-angular");
  } else {
    expect(vite).toContain("client-angular/**");
    expect(vite).not.toContain("client/src/routeTree.gen.ts");
  }
  expect(vite).not.toContain("cli/");
  const gitignore = await readFile(join(dir, ".gitignore"), "utf8");
  expect(gitignore).not.toContain("cli/");

  if (flavor === "angular") {
    const angular = await readJson<AngularJson>(join(dir, "client-angular", "angular.json"));
    const project = angular.projects?.[CLIENT_PACKAGE];
    expect(Object.keys(angular.projects ?? {})).toEqual([CLIENT_PACKAGE]);
    expect(project?.prefix).toBe(PROJECT);
    expect(project?.architect?.serve?.configurations?.production.buildTarget).toBe(
      `${CLIENT_PACKAGE}:build:production`,
    );
    expect(JSON.stringify(angular)).not.toContain("client-angular:");

    const eslint = await readFile(join(dir, "client-angular", "eslint.config.mjs"), "utf8");
    expect(eslint).toContain(`prefix: "${PROJECT}"`);
    expect(eslint).not.toContain('prefix: "app"');

    const app = await readFile(join(dir, "client-angular", "src", "app", "app.ts"), "utf8");
    expect(app).toContain(`selector: "${PROJECT}-root"`);
    expect(app).toContain(`<h1>${DISPLAY}</h1>`);

    const index = await readFile(join(dir, "client-angular", "src", "index.html"), "utf8");
    expect(index).toContain(`<${PROJECT}-root></${PROJECT}-root>`);
    expect(index).toContain(`<title>${DISPLAY}</title>`);
  } else {
    const index = await readFile(join(dir, "client", "index.html"), "utf8");
    expect(index).toContain(`<title>${DISPLAY}</title>`);
    const root = await readFile(join(dir, "client", "src", "routes", "__root.tsx"), "utf8");
    expect(root).toContain(`<h1>${DISPLAY}</h1>`);
  }

  for (const file of await walk(dir)) {
    const text = await readFile(join(dir, file), "utf8");
    expect({ file, cr: text.includes("\r") }).toEqual({ file, cr: false });
    expect({ file, starter: text.includes("lightweight-web-app-starter") }).toEqual({
      file,
      starter: false,
    });
    expect({ file, title: text.includes("Lightweight web app") }).toEqual({ file, title: false });
  }
  expect(await findLeftovers(dir, flavor, PROJECT)).toEqual([]);

  expect((await stat(join(dir, ".gitignore"))).isFile()).toBe(true);
  expect((await stat(join(dir, ".npmrc"))).isFile()).toBe(true);
  expect((await stat(join(dir, ".gitattributes"))).isFile()).toBe(true);
  expect(await stat(join(dir, "_gitignore")).catch(() => null)).toBeNull();
  expect(await stat(join(dir, "bun.lock")).catch(() => null)).toBeNull();
  expect((await stat(join(dir, "server", "drizzle", "0000_soft_alice.sql"))).isFile()).toBe(true);
  expect((await stat(join(dir, "server", "drizzle", "meta", "_journal.json"))).isFile()).toBe(true);

  const readme = await readFile(join(dir, "README.md"), "utf8");
  expect(readme.startsWith(`# ${DISPLAY}\n`)).toBe(true);
  expect(readme).not.toContain("Copying this baseline");
  expect(readme).not.toContain("Keeping only the Angular flavor");
  if (flavor === "react") {
    expect(readme).not.toContain("Angular flavor");
    expect(readme).toContain("bun run dev");
  } else {
    expect(readme).not.toContain("React flavor");
    expect(readme).toContain("bun run dev:angular");
  }
  expect(readme).toContain(
    schema === "zod" ? "Zod validates request bodies;" : "Effect Schema validates request bodies;",
  );
  if (schema === "effect") {
    expect(readme).toContain("oRPC v1, Effect, Drizzle, SQLite");
    expect(readme).not.toContain("oRPC v1, Effect, Zod, Drizzle, SQLite");
  }
}

test("scaffolds the react flavor", async () => {
  const dir = await makeTarget("react");
  await scaffold({ flavor: "react", projectName: PROJECT, targetDir: dir, schema: "zod" });
  await assertScaffold("react", dir);
});

test("scaffolds the angular flavor", async () => {
  const dir = await makeTarget("angular");
  await scaffold({ flavor: "angular", projectName: PROJECT, targetDir: dir, schema: "zod" });
  await assertScaffold("angular", dir);
});

test("scaffolds the react flavor with effect schemas", async () => {
  const dir = await makeTarget("react");
  const result = await scaffold({
    flavor: "react",
    projectName: PROJECT,
    targetDir: dir,
    schema: "effect",
  });
  expect(result.schema).toBe("effect");
  await assertScaffold("react", dir, "effect");
});

test("scaffolds the angular flavor with effect schemas", async () => {
  const dir = await makeTarget("angular");
  const result = await scaffold({
    flavor: "angular",
    projectName: PROJECT,
    targetDir: dir,
    schema: "effect",
  });
  expect(result.schema).toBe("effect");
  await assertScaffold("angular", dir, "effect");
});

test("keeps existing files and reports the skip", async () => {
  const dir = await makeTarget("react");
  const existing = join(dir, "README.md");
  const existingText = "# My notes\n\nThe lightweight-web-app-starter name is taken.\n";
  await mkdir(dir, { recursive: true });
  await writeFile(existing, existingText);

  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    const result = await scaffold({
      flavor: "react",
      projectName: PROJECT,
      targetDir: dir,
      schema: "zod",
    });
    expect(result.skipped).toEqual(["README.md"]);
  } finally {
    log.mockRestore();
  }

  expect(await readFile(existing, "utf8")).toBe(existingText);
  expect(lines.some((line) => line.includes("skipped existing file: README.md"))).toBe(true);
});

test("keeps a user-owned file at an effect overlay destination", async () => {
  const dir = await makeTarget("react");
  // Deliberate split: `server/src/env.ts` is shipped by both the base tree and
  // the overlay, so a pre-existing copy wins at both layers. The other overlay
  // paths (contract, tests, manifests) are base-written and must still be
  // replaced with the effect content in the same run.
  const userEnv = join(dir, "server", "src", "env.ts");
  const userText = "// hand-written env\nexport const env = { PORT: 4000 };\n";
  await mkdir(dirname(userEnv), { recursive: true });
  await writeFile(userEnv, userText);

  const result = await scaffold({
    flavor: "react",
    projectName: PROJECT,
    targetDir: dir,
    schema: "effect",
  });

  expect(result.schema).toBe("effect");
  expect(result.skipped).toEqual(["server/src/env.ts"]);
  expect(await readFile(userEnv, "utf8")).toBe(userText);

  const contract = await readFile(join(dir, "shared", "notes.contract.ts"), "utf8");
  expect(contract).toContain('import { Schema, SchemaTransformation } from "effect";');
  expect(await readFile(join(dir, "server", "test", "env.test.ts"), "utf8")).toContain(
    'from "@server/env"',
  );
  const sharedPkg = await readJson<PackageJson>(join(dir, "shared", "package.json"));
  expect(sharedPkg.dependencies?.effect).toBe("4.1.0");
  expect(sharedPkg.dependencies?.zod).toBeUndefined();
  const serverPkg = await readJson<PackageJson>(join(dir, "server", "package.json"));
  expect(serverPkg.dependencies?.effect).toBe("4.1.0");
  expect(serverPkg.dependencies?.zod).toBeUndefined();
});

test("scaffolds a numeric name with the fallback prefix", async () => {
  const dir = await makeTarget("angular", "123");
  const result = await scaffold({
    flavor: "angular",
    projectName: "123",
    targetDir: dir,
    schema: "zod",
  });
  expect(result.displayName).toBe("123");

  const angular = await readJson<AngularJson>(join(dir, "client-angular", "angular.json"));
  expect(angular.projects?.["123-client"]?.prefix).toBe("app");
  const app = await readFile(join(dir, "client-angular", "src", "app", "app.ts"), "utf8");
  expect(app).toContain('selector: "app-root"');
});

test("accepts the starter name as the project name", async () => {
  const name = "lightweight-web-app-starter";
  const dir = await makeTarget("react", name);
  const result = await scaffold({
    flavor: "react",
    projectName: name,
    targetDir: dir,
    schema: "zod",
  });
  expect(result.displayName).toBe("Lightweight Web App Starter");
  const pkg = await readJson<PackageJson>(join(dir, "package.json"));
  expect(pkg.name).toBe(name);
  expect(pkg.scripts?.["dev:client"]).toBe(`bun run --filter ${name}-client dev`);
  const readme = await readFile(join(dir, "README.md"), "utf8");
  expect(readme.startsWith("# Lightweight Web App Starter\n")).toBe(true);
});

test("does not hide leftovers matching the project name", async () => {
  const dir = await makeTarget("react", "client-angular");
  await scaffold({ flavor: "react", projectName: "client-angular", targetDir: dir, schema: "zod" });
  const path = "unexpected.txt";
  await writeFile(join(dir, path), "client-angular");
  expect(await findLeftovers(dir, "react", "client-angular", [path])).toContain(
    "unexpected.txt: client-angular",
  );
});

test("prints literal paths in both next steps and manual instructions", async () => {
  const targetDir = process.platform === "win32" ? "C:\\space $(`x`)" : "/tmp/space ' $(`x`)";
  expect(quotePath(targetDir)).toBe(
    process.platform === "win32" ? "'C:\\space $(`x`)'" : "'/tmp/space '\\'' $(`x`)'",
  );
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    await bootstrap({ targetDir, flavor: "react", install: false });
  } finally {
    log.mockRestore();
  }
  expect(lines).toContain(`    cd ${quotePath(targetDir)}`);
});

test.skipIf(process.platform !== "win32")(
  "resolves relative Windows PATH entries absolutely",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "mh-stack-path-"));
    created.push(root);
    await mkdir(join(root, "tools"));
    await link(process.execPath, join(root, "tools", "bun.exe"));
    const module = join(REPO_ROOT, "cli", "src", "bootstrap.ts").replaceAll("\\", "/");
    const result = spawnSync(
      process.execPath,
      ["-e", `import { resolveBun } from ${JSON.stringify(module)}; console.log(resolveBun());`],
      { cwd: root, env: { ...process.env, PATH: "tools" }, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim().toLowerCase()).toBe(join(root, "tools", "bun.exe").toLowerCase());
  },
);

test("the built entry starts with the node shebang", async () => {
  const entry = await readFile(CLI_ENTRY, "utf8");
  expect(entry.split("\n")[0]).toBe("#!/usr/bin/env node");
});

test("prints the flag recipe when stdin is not a TTY", () => {
  const result = spawnSync("node", [CLI_ENTRY], { encoding: "utf8", input: "" });
  const output = `${result.stdout}${result.stderr}`;
  expect(result.status).not.toBe(0);
  expect(output).toContain("mh-stack needs a TTY for prompts. Non-interactive usage:");
  expect(output).toContain("npx mh-stack --react --name my-app my-app");
  expect(output).toContain("npx mh-stack --angular --name my-app my-app");
  expect(output).toContain("--zod | --effect");
});

test("spawned entry scaffolds the react flavor", async () => {
  const dir = await makeTarget("react");
  const env = { ...process.env };
  if (!env.MH_STACK_TEMPLATES_DIR) env.MH_STACK_TEMPLATES_DIR = templatesRoot();
  const result = spawnSync("node", [CLI_ENTRY, "--react", "--name", PROJECT, "--no-install", dir], {
    encoding: "utf8",
    env,
  });
  expect(result.status).toBe(0);
  expect(result.stdout.split("\n")[0]).toBe(`mh-stack ${version}`);
  await assertScaffold("react", dir);
});

test("spawned entry scaffolds the angular flavor", async () => {
  const dir = await makeTarget("angular");
  // Deliberately unset: this child must resolve templates next to its own entry
  // (`dist/../templates`), which is the packaged default the artifact smoke uses.
  const env = { ...process.env };
  delete env.MH_STACK_TEMPLATES_DIR;
  const result = spawnSync(
    "node",
    [CLI_ENTRY, "--angular", "--name", PROJECT, "--no-install", dir],
    {
      encoding: "utf8",
      env,
    },
  );
  expect(result.status).toBe(0);
  expect(result.stdout.split("\n")[0]).toBe(`mh-stack ${version}`);
  await assertScaffold("angular", dir);
});

test("spawned entry defaults to zod without a schema flag", async () => {
  const dir = await makeTarget("react");
  const env = { ...process.env, MH_STACK_TEMPLATES_DIR: templatesRoot() };
  const result = spawnSync("node", [CLI_ENTRY, "--react", "--name", PROJECT, "--no-install", dir], {
    encoding: "utf8",
    env,
  });
  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain("Schema library:");
  const contract = await readFile(join(dir, "shared", "notes.contract.ts"), "utf8");
  expect(contract).toContain('import { z } from "zod";');
  expect(contract).not.toContain('from "effect"');
});

test("spawned entry scaffolds the effect variant", async () => {
  const dir = await makeTarget("angular");
  const env = { ...process.env, MH_STACK_TEMPLATES_DIR: templatesRoot() };
  const result = spawnSync(
    "node",
    [CLI_ENTRY, "--angular", "--effect", "--name", PROJECT, "--no-install", dir],
    { encoding: "utf8", env },
  );
  expect(result.status).toBe(0);
  await assertScaffold("angular", dir, "effect");
});

afterAll(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
});
