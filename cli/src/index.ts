#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { styleText } from "node:util";
import pkg from "../package.json";
import { bootstrap } from "./bootstrap.ts";
import { RECIPE, USAGE } from "./options.ts";
import {
  askDatabase,
  askDirectory,
  askFlavor,
  askProjectName,
  askSchemaLibrary,
  confirmNonEmpty,
} from "./prompts.ts";
import { validateProjectName, type Flavor } from "./rename.ts";
import { scaffold, type DbEngine, type SchemaLib } from "./scaffold.ts";

interface ParsedArgs {
  flavor?: Flavor;
  schema?: SchemaLib;
  db?: DbEngine;
  name?: string;
  target?: string;
  install: boolean;
  help: boolean;
  version: boolean;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { install: true, help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--react" || arg === "--angular") {
      const flavor: Flavor = arg === "--react" ? "react" : "angular";
      if (parsed.flavor && parsed.flavor !== flavor) fail("Choose one of --react or --angular.");
      parsed.flavor = flavor;
    } else if (arg === "--zod" || arg === "--effect") {
      const schema: SchemaLib = arg === "--zod" ? "zod" : "effect";
      if (parsed.schema && parsed.schema !== schema) fail("Choose one of --zod or --effect.");
      parsed.schema = schema;
    } else if (arg === "--sqlite" || arg === "--postgres") {
      const db: DbEngine = arg === "--sqlite" ? "sqlite" : "postgres";
      if (parsed.db && parsed.db !== db) fail("Choose one of --sqlite or --postgres.");
      parsed.db = db;
    } else if (arg === "--name") {
      const value = argv[index + 1];
      if (!value) fail("--name needs a value.");
      parsed.name = value;
      index += 1;
    } else if (arg.startsWith("--name=")) {
      parsed.name = arg.slice("--name=".length);
    } else if (arg === "--no-install") {
      parsed.install = false;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--version" || arg === "-v") {
      parsed.version = true;
    } else if (arg.startsWith("-")) {
      fail(`Unknown flag: ${arg}\n${RECIPE}`);
    } else if (parsed.target) {
      fail(`Unexpected argument: ${arg}`);
    } else {
      parsed.target = arg;
    }
  }
  return parsed;
}

async function isNonEmptyDirectory(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) return false;
  return (await readdir(path)).length > 0;
}

async function main(): Promise<void> {
  console.log(`lwapp ${pkg.version}`);
  const argv = process.argv.slice(2).filter((arg) => arg !== "--");
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (parsed.version) return;

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let { flavor, name, target, schema, db } = parsed;
  if (!interactive) {
    if (!flavor || !target) fail(RECIPE);
    if (name === undefined) {
      name = basename(resolve(target));
      const invalid = validateProjectName(name);
      if (invalid) fail(`${invalid} Specify a valid project name with --name <name>.`);
    }
  }
  if (name !== undefined) {
    const invalid = validateProjectName(name);
    if (invalid) fail(invalid);
  }

  name ??= await askProjectName();
  flavor ??= await askFlavor();
  schema ??= interactive ? await askSchemaLibrary() : "zod";
  db ??= interactive ? await askDatabase() : "sqlite";
  target ??= await askDirectory(name);

  const targetDir = resolve(target);
  if (await isNonEmptyDirectory(targetDir)) {
    if (!interactive) {
      fail(`Target directory is not empty: ${targetDir}. Choose an empty directory.`);
    }
    if (!(await confirmNonEmpty(targetDir))) fail("Aborted.");
  }

  const result = await scaffold({ flavor, projectName: name, targetDir, schema, db });
  for (const path of result.skipped) {
    console.log(`${styleText("yellow", "!")} skipped existing file: ${path}`);
  }
  await bootstrap({ targetDir, flavor, install: parsed.install, db });
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
