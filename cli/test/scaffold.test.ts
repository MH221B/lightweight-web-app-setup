import { afterAll, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { link, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap, quotePath } from "../src/bootstrap.ts";
import { findLeftovers, type Flavor } from "../src/rename.ts";
import { OPTIONS } from "../src/options.ts";
import {
  COMBOS,
  scaffold,
  templatesRoot,
  type DbEngine,
  type SchemaLib,
  type StyleChoice,
} from "../src/scaffold.ts";

interface PackageJson {
  name?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
  overrides?: Record<string, string | Record<string, string>>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface AngularJson {
  projects?: Record<string, AngularProject>;
}

interface AngularProject {
  prefix?: string;
  schematics?: Record<string, { style?: string }>;
  architect?: {
    build?: { options?: { styles?: string[]; inlineStyleLanguage?: string } };
    serve?: { configurations?: Record<string, { buildTarget?: string }> };
  };
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_ENTRY = process.env.LWAPP_CLI_ENTRY ?? join(REPO_ROOT, "cli", "dist", "index.js");
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
  const root = await mkdtemp(join(tmpdir(), `lwapp-${flavor}-`));
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
  db: DbEngine = "sqlite",
  style: StyleChoice = "scss",
): Promise<void> {
  const sharedPkg = await readJson<PackageJson>(join(dir, "shared", "package.json"));
  const serverPkg = await readJson<PackageJson>(join(dir, "server", "package.json"));
  const contract = await readFile(join(dir, "shared", "notes.contract.ts"), "utf8");
  const env = await readFile(join(dir, "server", "src", "env.ts"), "utf8");
  const envTest = await readFile(join(dir, "server", "test", "env.test.ts"), "utf8");
  const contractTest = await readFile(join(dir, "server", "test", "contract.test.ts"), "utf8");
  const readme = await readFile(join(dir, "README.md"), "utf8");

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

  if (flavor === "angular") {
    const notesPage = await readFile(
      join(dir, "client-angular", "src", "app", "notes", "notes-page.ts"),
      "utf8",
    );
    expect(notesPage).toContain(`selector: "${PROJECT}-notes-page"`);
  }

  const drizzleConfig = await readFile(join(dir, "server", "drizzle.config.ts"), "utf8");
  const dbClient = await readFile(join(dir, "server", "src", "db.ts"), "utf8");

  expect(await stat(join(dir, "removals.json")).catch(() => null)).toBeNull();

  if (db === "postgres") {
    expect(drizzleConfig).toContain('dialect: "postgresql"');
    expect(drizzleConfig).toContain('out: "./drizzle-pg"');
    expect((await stat(join(dir, "server", "drizzle-pg", "meta", "_journal.json"))).isFile()).toBe(
      true,
    );
    expect(
      (await readdir(join(dir, "server", "drizzle-pg"))).some((name) =>
        /^0000_.*\.sql$/.test(name),
      ),
    ).toBe(true);
    expect(await stat(join(dir, "server", "drizzle")).catch(() => null)).toBeNull();
    expect((await stat(join(dir, "server", "test", "test-database.ts"))).isFile()).toBe(true);
    expect(dbClient).toContain('from "drizzle-orm/postgres-js"');
    expect(dbClient).toContain('"../drizzle-pg"');
    expect(dbClient).toContain("@server/schema");
    expect(dbClient).toContain("current_database");
    expect(dbClient).toContain("refusing to run");
    expect(dbClient).not.toContain("bun:sqlite");
    expect(serverPkg.dependencies?.postgres).toBe("3.4.9");
    expect(env).toContain("DATABASE_URL");
    expect(env).not.toContain("DATABASE_PATH");
    expect(await readFile(join(dir, "server", "test", "env.cases.ts"), "utf8")).toContain(
      "DATABASE_URL",
    );
    expect(readme).not.toContain("SQLite");
    expect(readme).not.toContain("DATABASE_PATH");
    expect(readme).not.toContain("server/data/");
    expect(readme).toContain("starter_test_<random>");
    expect(readme).toContain("CREATEDB");
    expect(readme).toContain("never migrated or mutated");
    expect(readme).toContain("best-effort");
    expect(readme).toContain("server/drizzle-pg/");
    expect(
      await stat(join(dir, "server", "test", "test-database.probe.ts")).catch(() => null),
    ).toBeNull();
  } else {
    expect(drizzleConfig).toContain('dialect: "sqlite"');
    expect(
      (await readdir(join(dir, "server", "drizzle"))).filter((name) => name.endsWith(".sql")),
    ).toHaveLength(1);
    expect((await stat(join(dir, "server", "drizzle", "meta", "_journal.json"))).isFile()).toBe(
      true,
    );
    expect(await stat(join(dir, "server", "drizzle-pg")).catch(() => null)).toBeNull();
    expect(
      await stat(join(dir, "server", "test", "test-database.ts")).catch(() => null),
    ).toBeNull();
    expect(
      await stat(join(dir, "server", "test", "test-database.probe.ts")).catch(() => null),
    ).toBeNull();
    expect(dbClient).toContain('from "bun:sqlite"');
    expect(serverPkg.dependencies?.postgres).toBeUndefined();
    expect(env).toContain("DATABASE_PATH");
    expect(env).not.toContain("DATABASE_URL");
    expect(readme).not.toContain("PostgreSQL");
  }

  // The rendered diagram and the Verification instructions must agree with the
  // selected database. The svg is generated from the mmd, so check both.
  const diagramSource = await readFile(join(dir, "architecture.mmd"), "utf8");
  const diagram = await readFile(join(dir, "architecture.svg"), "utf8");
  const databaseLabel = db === "postgres" ? "PostgreSQL" : "SQLite";
  const otherDatabaseLabel = db === "postgres" ? "SQLite" : "PostgreSQL";
  for (const text of [diagramSource, diagram]) {
    expect(text).toContain(databaseLabel);
    expect(text).not.toContain(otherDatabaseLabel);
  }
  const sourceLabels = [
    ...Array.from(
      diagramSource.matchAll(/^\s*\w+\[\(?(.+?)\)?\]/gm),
      (match) => match[1] ?? "",
    ).flatMap((label) => label.split("<br/>")),
    ...Array.from(diagramSource.matchAll(/\|([^|]+)\|/g), (match) => match[1] ?? ""),
    ...Array.from(diagramSource.matchAll(/^\s*subgraph (.+)$/gm), (match) => match[1] ?? ""),
  ];
  const svgLabels = Array.from(
    diagram.matchAll(/<(?:text|tspan)\b[^>]*>([^<]+)<\/(?:text|tspan)>/g),
    (match) => match[1] ?? "",
  );
  expect(svgLabels.sort()).toEqual(sourceLabels.sort());
  expect(readme).toContain("shared/notes.meta.ts");
  if (db === "postgres") {
    expect(readme).toContain("`7 pass`, `23 skip`");
    expect(readme).toContain("`24 pass`");
  } else {
    expect(readme).not.toContain("23 skip");
    expect(readme).toContain("`24 pass`");
  }

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

  // Styling assertions, keyed off the selected client's manifest.
  const stylingPackage = (name: string) => clientPkg.devDependencies?.[name];

  if (flavor === "react") {
    const main = await readFile(join(dir, "client", "src", "main.tsx"), "utf8");
    const scssFiles = (await walk(join(dir, "client"))).filter((file) => file.endsWith(".scss"));
    const hasTailwindEntry =
      (await stat(join(dir, "client", "src", "tailwind.css")).catch(() => null)) !== null;

    if (style === "scss") {
      expect(scssFiles.sort()).toEqual(["src/styles.scss", "src/styles/_tokens.scss"]);
      const entry = await readFile(join(dir, "client", "src", "styles.scss"), "utf8");
      expect(entry).toContain('@use "./styles/tokens"');
      expect(entry).toContain("&:focus-visible");
      expect(main).toContain('import "./styles.scss";');
      expect(stylingPackage("sass-embedded")).toBe("1.108.2");
      expect(stylingPackage("tailwindcss")).toBeUndefined();
      expect(stylingPackage("@tailwindcss/vite")).toBeUndefined();
      expect(hasTailwindEntry).toBe(false);
    } else if (style === "tailwind") {
      expect(scssFiles).toEqual([]);
      expect(await readFile(join(dir, "client", "src", "tailwind.css"), "utf8")).toContain(
        '@import "tailwindcss";',
      );
      expect(await readFile(join(dir, "client", "vite.config.ts"), "utf8")).toContain(
        'from "@tailwindcss/vite"',
      );
      expect(main).toContain('import "./tailwind.css";');
      expect(main).not.toContain("./styles.scss");
      expect(stylingPackage("sass-embedded")).toBeUndefined();
      expect(stylingPackage("tailwindcss")).toBe("4.3.5");
      expect(stylingPackage("@tailwindcss/vite")).toBe("4.3.5");
    } else {
      expect(scssFiles.sort()).toEqual(["src/styles.scss", "src/styles/_tokens.scss"]);
      expect(hasTailwindEntry).toBe(true);
      expect(main).toContain('import "./tailwind.css";');
      expect(main).toContain('import "./styles.scss";');
      expect(main.indexOf('import "./tailwind.css";')).toBeLessThan(
        main.indexOf('import "./styles.scss";'),
      );
      expect(stylingPackage("sass-embedded")).toBe("1.108.2");
      expect(stylingPackage("tailwindcss")).toBe("4.3.5");
      expect(stylingPackage("@tailwindcss/vite")).toBe("4.3.5");
    }
    expect(await stat(join(dir, "server", "src", "styles.scss")).catch(() => null)).toBeNull();
    expect(await stat(join(dir, "shared", "tailwind.css")).catch(() => null)).toBeNull();
  } else {
    const angularJson = await readJson<AngularJson>(join(dir, "client-angular", "angular.json"));
    const angularJsonText = await readFile(join(dir, "client-angular", "angular.json"), "utf8");
    const project = angularJson.projects?.[CLIENT_PACKAGE];
    const buildOptions = project?.architect?.build?.options;
    const componentStyle = project?.schematics?.["@schematics/angular:component"]?.style;
    const app = await readFile(join(dir, "client-angular", "src", "app", "app.ts"), "utf8");
    const notesPageFile = await readFile(
      join(dir, "client-angular", "src", "app", "notes", "notes-page.ts"),
      "utf8",
    );
    const scssFiles = (await walk(join(dir, "client-angular", "src"))).filter((file) =>
      file.endsWith(".scss"),
    );
    const postcss =
      (await stat(join(dir, "client-angular", ".postcssrc.json")).catch(() => null)) !== null;

    // The rename must not re-serialize angular.json: Oxfmt keeps short arrays
    // inline, so an expanded `styles` block fails the generated project's check.
    expect(angularJsonText).toContain(
      {
        scss: '"styles": ["src/styles.scss"]',
        tailwind: '"styles": ["src/tailwind.css"]',
        both: '"styles": ["src/tailwind.css", "src/styles.scss"]',
      }[style],
    );

    if (style === "scss") {
      expect(buildOptions?.styles).toEqual(["src/styles.scss"]);
      expect(buildOptions?.inlineStyleLanguage).toBe("scss");
      expect(componentStyle).toBe("scss");
      expect(app).toContain('styleUrl: "./app.scss"');
      expect(notesPageFile).toContain('styleUrl: "./notes-page.scss"');
      expect(scssFiles.sort()).toEqual([
        "app/app.scss",
        "app/notes/notes-page.scss",
        "styles.scss",
        "styles/_tokens.scss",
      ]);
      expect(postcss).toBe(false);
      expect(stylingPackage("sass-embedded")).toBe("1.108.2");
      expect(stylingPackage("tailwindcss")).toBeUndefined();
    } else if (style === "tailwind") {
      expect(buildOptions?.styles).toEqual(["src/tailwind.css"]);
      expect(buildOptions?.inlineStyleLanguage).toBeUndefined();
      expect(componentStyle).toBe("css");
      expect(app).not.toContain("styleUrl");
      expect(notesPageFile).not.toContain("styleUrl");
      expect(scssFiles).toEqual([]);
      expect(postcss).toBe(true);
      expect(
        await readJson<{ plugins: Record<string, unknown> }>(
          join(dir, "client-angular", ".postcssrc.json"),
        ),
      ).toEqual({ plugins: { "@tailwindcss/postcss": {} } });
      expect(stylingPackage("sass-embedded")).toBeUndefined();
      expect(stylingPackage("tailwindcss")).toBe("4.3.5");
      expect(stylingPackage("@tailwindcss/postcss")).toBe("4.3.5");
      expect(stylingPackage("postcss")).toBe("8.5.32");
    } else {
      expect(buildOptions?.styles).toEqual(["src/tailwind.css", "src/styles.scss"]);
      expect(buildOptions?.inlineStyleLanguage).toBe("scss");
      expect(componentStyle).toBe("scss");
      expect(app).toContain('styleUrl: "./app.scss"');
      expect(notesPageFile).toContain('styleUrl: "./notes-page.scss"');
      expect(postcss).toBe(true);
      expect(stylingPackage("sass-embedded")).toBe("1.108.2");
      expect(stylingPackage("tailwindcss")).toBe("4.3.5");
      expect(stylingPackage("@tailwindcss/postcss")).toBe("4.3.5");
      expect(stylingPackage("postcss")).toBe("8.5.32");
    }
    expect(await stat(join(dir, "server", "src", "styles.scss")).catch(() => null)).toBeNull();
    expect(await stat(join(dir, "shared", "tailwind.css")).catch(() => null)).toBeNull();
  }

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
    expect(pkg.overrides?.["@angular/build"]).toBeUndefined();
  } else {
    expect(pkg.scripts?.dev).toBeUndefined();
    expect(pkg.scripts?.routes).toBeUndefined();
    expect(pkg.scripts?.build).toBe(`bun run --filter ${CLIENT_PACKAGE} build`);
    expect(pkg.scripts?.["dev:angular-client"]).toBe(`bun run --filter ${CLIENT_PACKAGE} start`);
    expect(pkg.scripts?.check).toBe(`vp check && bun run --filter ${CLIENT_PACKAGE} lint`);
    expect(pkg.scripts?.typecheck).toBe("vp check --no-fmt --no-lint");
    expect(pkg.overrides?.["@angular/build"]).toEqual({ vite: "8.3.8" });
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
    for (const token of [
      "--filter client ",
      "/variants/",
      'selector: "app-',
      "<app-root",
      "</app-root>",
      'prefix: "app"',
      ...(flavor === "react" ? ["client-angular", "@angular/"] : ["@client/", "routeTree.gen.ts"]),
    ]) {
      expect({ file, token, found: text.includes(token) }).toEqual({ file, token, found: false });
    }
  }

  expect((await stat(join(dir, ".gitignore"))).isFile()).toBe(true);
  expect((await stat(join(dir, ".npmrc"))).isFile()).toBe(true);
  expect((await stat(join(dir, ".gitattributes"))).isFile()).toBe(true);
  expect(await stat(join(dir, "_gitignore")).catch(() => null)).toBeNull();
  expect(await stat(join(dir, "bun.lock")).catch(() => null)).toBeNull();

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
    expect(readme).toContain(
      db === "postgres"
        ? "oRPC v1, Effect, Drizzle, PostgreSQL"
        : "oRPC v1, Effect, Drizzle, SQLite",
    );
    expect(readme).not.toContain("oRPC v1, Effect, Zod, Drizzle, SQLite");
  }

  expect(readme).toContain(
    "Client styling is configured in the client directory. See its package manifest and stylesheet entries for the selected setup.",
  );
  expect(readme).not.toContain("The checked-in React and Angular clients use SCSS.");
}

for (const combo of COMBOS) {
  test(`scaffolds ${combo.flavor} ${combo.schema} ${combo.db} ${combo.style}`, async () => {
    const dir = await makeTarget(combo.flavor);
    const result = await scaffold({
      flavor: combo.flavor,
      projectName: PROJECT,
      targetDir: dir,
      schema: combo.schema,
      db: combo.db,
      style: combo.style,
    });
    expect(result.schema).toBe(combo.schema);
    expect(result.db).toBe(combo.db);
    expect(result.style).toBe(combo.style);
    await assertScaffold(combo.flavor, dir, combo.schema, combo.db, combo.style);
  });
}

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
      db: "sqlite",
    });
    expect(result.skipped).toEqual(["README.md"]);
  } finally {
    log.mockRestore();
  }

  expect(await readFile(existing, "utf8")).toBe(existingText);
  expect(lines).toEqual([]);
});

test("rejects variant conflicts with existing files", async () => {
  const dir = await makeTarget("react");
  // Deliberate split: `server/src/env.ts` is shipped by both the base tree and
  // the overlay, so a pre-existing copy wins at both layers. The other overlay
  // paths (contract, tests, manifests) are base-written and must still be
  // replaced with the effect content in the same run.
  const userEnv = join(dir, "server", "src", "env.ts");
  const userText = "// hand-written env\nexport const env = { PORT: 4000 };\n";
  await mkdir(dirname(userEnv), { recursive: true });
  await writeFile(userEnv, userText);

  const error = await scaffold({
    flavor: "react",
    projectName: PROJECT,
    targetDir: dir,
    schema: "effect",
    db: "sqlite",
  }).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(Error);
  expect(error).toHaveProperty(
    "message",
    "Overlay conflicts with an existing file: server/src/env.ts",
  );
  expect(await readFile(userEnv, "utf8")).toBe(userText);

  const rerun = await makeTarget("react");
  const options = {
    flavor: "react" as const,
    projectName: PROJECT,
    targetDir: rerun,
    db: "sqlite" as const,
  };
  await scaffold({ ...options, schema: "effect" });
  const rerunError = await scaffold({ ...options, schema: "zod" }).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(rerunError).toBeInstanceOf(Error);
  expect(rerunError).toHaveProperty(
    "message",
    "Cannot determine existing scaffold variant: server/src/env.ts",
  );
});

test("keeps user files inside a removed sqlite directory", async () => {
  const dir = await makeTarget("react");
  await mkdir(join(dir, "server", "drizzle"), { recursive: true });
  await writeFile(join(dir, "server", "drizzle", "custom.sql"), "-- mine\n");
  const result = await scaffold({
    flavor: "react",
    projectName: PROJECT,
    targetDir: dir,
    schema: "zod",
    db: "postgres",
  });
  expect(result.removed).toEqual(["server/drizzle.config.ts", "server/drizzle/"]);
  expect(await readFile(join(dir, "server", "drizzle", "custom.sql"), "utf8")).toBe("-- mine\n");
  expect(
    (await readdir(join(dir, "server", "drizzle"))).filter((name) => name.endsWith(".sql")),
  ).toEqual(["custom.sql"]);
  expect(await stat(join(dir, "server", "drizzle", "meta")).catch(() => null)).toBeNull();
});

test("scaffolds a numeric name with the fallback prefix", async () => {
  const dir = await makeTarget("angular", "123");
  const result = await scaffold({
    flavor: "angular",
    projectName: "123",
    targetDir: dir,
    schema: "zod",
    db: "sqlite",
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
    db: "sqlite",
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
  await scaffold({
    flavor: "react",
    projectName: "client-angular",
    targetDir: dir,
    schema: "zod",
    db: "sqlite",
  });
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
    await bootstrap({ targetDir, flavor: "react", install: false, db: "sqlite" });
  } finally {
    log.mockRestore();
  }
  expect(lines).toContain(`    cd ${quotePath(targetDir)}`);
});

test.skipIf(process.platform !== "win32")(
  "resolves relative Windows PATH entries absolutely",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lwapp-path-"));
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
  expect(output).toContain("lwapp needs a TTY for prompts. Non-interactive usage:");
  expect(output).toContain("npx lwapp --react my-app");
  expect(output).toContain("npx lwapp --angular my-app");
  for (const args of [["--react"], ["my-app"]]) {
    const missing = spawnSync("node", [CLI_ENTRY, ...args], { encoding: "utf8", input: "" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("lwapp needs a TTY for prompts. Non-interactive usage:");
  }
  for (const option of OPTIONS) {
    expect(output).toContain(option.flags.replace(/^-[a-z], /, ""));
  }
  const help = spawnSync("node", [CLI_ENTRY, "--help"], { encoding: "utf8" });
  expect(help.status).toBe(0);
  for (const option of OPTIONS) {
    expect(help.stdout).toContain(option.flags);
    expect(help.stdout).toContain(option.description);
  }
});

test("derives and validates non-interactive names, with an explicit override", async () => {
  const root = await mkdtemp(join(tmpdir(), "lwapp-name-"));
  created.push(root);
  const env = { ...process.env, LWAPP_TEMPLATES_DIR: templatesRoot() };
  const dir = join(root, "derived-app");
  const derived = spawnSync("node", [CLI_ENTRY, "--react", "--no-install", join(dir, ".")], {
    encoding: "utf8",
    env,
  });
  expect(derived.status).toBe(0);
  expect((await readJson<PackageJson>(join(dir, "package.json"))).name).toBe("derived-app");

  const invalidDir = join(root, "Invalid Name");
  const invalid = spawnSync("node", [CLI_ENTRY, "--react", "--no-install", invalidDir], {
    encoding: "utf8",
    env,
  });
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toContain("Use lowercase letters, digits, and hyphens only");
  expect(invalid.stderr).toContain("--name <name>");
  expect(await stat(invalidDir).catch(() => null)).toBeNull();

  const override = spawnSync(
    "node",
    [CLI_ENTRY, "--react", "--name", "override-app", "--no-install", invalidDir],
    { encoding: "utf8", env },
  );
  expect(override.status).toBe(0);
  expect((await readJson<PackageJson>(join(invalidDir, "package.json"))).name).toBe("override-app");
});

test("prints DATABASE_URL in the postgres manual recipe", async () => {
  const dir = await makeTarget("react");
  const env = { ...process.env, PATH: "", LWAPP_TEMPLATES_DIR: templatesRoot() };
  const result = spawnSync(
    process.execPath,
    [CLI_ENTRY, "--react", "--postgres", "--name", PROJECT, dir],
    { encoding: "utf8", env },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(
    process.platform === "win32"
      ? '    $env:DATABASE_URL = "postgres://user:pass@localhost:5432/my_app"; bun run db:migrate'
      : "    DATABASE_URL=postgres://user:pass@localhost:5432/my_app bun run db:migrate",
  );
  expect(result.stdout).not.toContain("> Installing dependencies");
});

test("spawned entry scaffolds the react flavor", async () => {
  const dir = await makeTarget("react");
  const env = { ...process.env };
  if (!env.LWAPP_TEMPLATES_DIR) env.LWAPP_TEMPLATES_DIR = templatesRoot();
  const result = spawnSync("node", [CLI_ENTRY, "--react", "--name", PROJECT, "--no-install", dir], {
    encoding: "utf8",
    env,
  });
  expect(result.status).toBe(0);
  expect(result.stdout.split("\n")[0]).toBe(`lwapp ${version}`);
  expect((await stat(join(dir, "client"))).isDirectory()).toBe(true);
  const shared = await readJson<PackageJson>(join(dir, "shared", "package.json"));
  expect(shared.dependencies?.zod).toBeDefined();
  expect((await stat(join(dir, "server", "drizzle"))).isDirectory()).toBe(true);
});

test("spawned entry scaffolds the angular flavor", async () => {
  const dir = await makeTarget("angular");
  // Deliberately unset: this child must resolve templates next to its own entry
  // (`dist/../templates`), which is the packaged default the artifact smoke uses.
  const env = { ...process.env };
  delete env.LWAPP_TEMPLATES_DIR;
  const result = spawnSync(
    "node",
    [CLI_ENTRY, "--angular", "--effect", "--postgres", "--name", PROJECT, "--no-install", dir],
    {
      encoding: "utf8",
      env,
    },
  );
  expect(result.status).toBe(0);
  expect(result.stdout.split("\n")[0]).toBe(`lwapp ${version}`);
  expect(result.stdout).toContain("DATABASE_URL");
  expect(result.stdout).toContain("bun run db:migrate");
  expect(result.stdout.indexOf("DATABASE_URL")).toBeLessThan(result.stdout.indexOf("Done."));
  expect((await stat(join(dir, "client-angular"))).isDirectory()).toBe(true);
  const shared = await readJson<PackageJson>(join(dir, "shared", "package.json"));
  expect(shared.dependencies?.effect).toBeDefined();
  expect((await stat(join(dir, "server", "drizzle-pg"))).isDirectory()).toBe(true);
});

test("rejects conflicting database flags before writing", async () => {
  const dir = await makeTarget("react");
  const env = { ...process.env, LWAPP_TEMPLATES_DIR: templatesRoot() };
  const result = spawnSync(
    "node",
    [CLI_ENTRY, "--react", "--sqlite", "--postgres", "--name", PROJECT, "--no-install", dir],
    { encoding: "utf8", env },
  );
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).toContain("Choose one of --sqlite or --postgres.");
  expect(await stat(dir).catch(() => null)).toBeNull();
});

test("layers a styling overlay on a schema overlay", async () => {
  const dir = await makeTarget("react");
  const result = await scaffold({
    flavor: "react",
    projectName: PROJECT,
    targetDir: dir,
    schema: "zod",
    db: "postgres",
    style: "tailwind",
  });

  expect(result.style).toBe("tailwind");
  expect(result.removed).toEqual([
    "server/drizzle.config.ts",
    "server/drizzle/",
    "client/src/styles.scss",
    "client/src/styles/",
  ]);
  expect(await readFile(join(dir, "client", "src", "tailwind.css"), "utf8")).toContain(
    '@import "tailwindcss";',
  );
  expect(await stat(join(dir, "client", "src", "styles.scss")).catch(() => null)).toBeNull();
  expect(await stat(join(dir, "client", "src", "styles")).catch(() => null)).toBeNull();
  expect(await readFile(join(dir, "server", "src", "db.ts"), "utf8")).toContain(
    "drizzle-orm/postgres-js",
  );
  expect((await stat(join(dir, "server", "drizzle-pg", "meta", "_journal.json"))).isFile()).toBe(
    true,
  );
  expect(await readFile(join(dir, "README.md"), "utf8")).toContain("DATABASE_URL");
});

test("keeps a user-owned stylesheet at a styling removal path", async () => {
  const dir = await makeTarget("react");
  const own = join(dir, "client", "src", "styles.scss");
  const text = "/* mine */\n";
  await mkdir(dirname(own), { recursive: true });
  await writeFile(own, text);

  const result = await scaffold({
    flavor: "react",
    projectName: PROJECT,
    targetDir: dir,
    schema: "zod",
    db: "sqlite",
    style: "tailwind",
  });

  expect(await readFile(own, "utf8")).toBe(text);
  expect(result.removed).toEqual(["client/src/styles/"]);
  expect(result.skipped).toContain("client/src/styles.scss");
  expect(await readFile(join(dir, "client", "src", "tailwind.css"), "utf8")).toContain(
    '@import "tailwindcss";',
  );
  expect(await readFile(join(dir, "client", "src", "routes", "__root.tsx"), "utf8")).toContain(
    "max-w-2xl",
  );
  expect(await stat(join(dir, "client", "src", "styles")).catch(() => null)).toBeNull();
});

test("syncs the Angular PostCSS dotfile through the overlay map", async () => {
  expect(
    (
      await stat(
        join(
          REPO_ROOT,
          "cli",
          "overlays",
          "angular",
          "style-tailwind",
          "client-angular",
          "_postcssrc.json",
        ),
      )
    ).isFile(),
  ).toBe(true);

  const dir = await makeTarget("angular");
  await scaffold({
    flavor: "angular",
    projectName: PROJECT,
    targetDir: dir,
    schema: "zod",
    db: "sqlite",
    style: "tailwind",
  });
  const postcss = await readJson<{ plugins: Record<string, unknown> }>(
    join(dir, "client-angular", ".postcssrc.json"),
  );
  expect(Object.keys(postcss.plugins)).toEqual(["@tailwindcss/postcss"]);
  expect(await stat(join(dir, "client-angular", "_postcssrc.json")).catch(() => null)).toBeNull();
});

test("rejects conflicting styling flags before writing", async () => {
  const dir = await makeTarget("react");
  const env = { ...process.env, LWAPP_TEMPLATES_DIR: templatesRoot() };
  const result = spawnSync(
    "node",
    [CLI_ENTRY, "--react", "--scss", "--tailwind", "--name", PROJECT, "--no-install", dir],
    { encoding: "utf8", env },
  );
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).toContain(
    "Choose one of --scss, --tailwind, or --both.",
  );
  expect(await stat(dir).catch(() => null)).toBeNull();
});

afterAll(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
});
