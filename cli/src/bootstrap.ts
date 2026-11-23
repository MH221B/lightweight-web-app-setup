import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { styleText } from "node:util";
import type { DbEngine } from "./scaffold.ts";
import type { Flavor } from "./rename.ts";

export interface BootstrapOptions {
  targetDir: string;
  flavor: Flavor;
  install: boolean;
  db: DbEngine;
}

function step(message: string): void {
  console.log(`${styleText("cyan", ">")} ${message}`);
}

function warn(message: string): void {
  console.log(`${styleText("yellow", "!")} ${message}`);
}

function run(
  command: string,
  args: string[],
  cwd: string,
  capture = false,
): { ok: boolean; output: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function devCommand(flavor: Flavor): string {
  return flavor === "react" ? "bun run dev" : "bun run dev:angular";
}

export function quotePath(path: string): string {
  return process.platform === "win32"
    ? `'${path.replaceAll("'", "''")}'`
    : `'${path.replaceAll("'", "'\\''")}'`;
}

function postgresMigrationCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? '$env:DATABASE_URL = "postgres://user:pass@localhost:5432/my_app"; bun run db:migrate'
    : "DATABASE_URL=postgres://user:pass@localhost:5432/my_app bun run db:migrate";
}

function printManual(targetDir: string, flavor: Flavor, db: DbEngine): void {
  console.log("");
  warn("Finish the setup manually:");
  console.log(`    cd ${quotePath(targetDir)}`);
  console.log("    bun install");
  if (db === "postgres") {
    console.log(`    ${postgresMigrationCommand()}`);
  } else {
    console.log("    bun run db:migrate");
  }
  console.log(`    ${devCommand(flavor)}`);
}

let resolvedBun: string | null | undefined;

// Windows npm installs bun behind bun.cmd/bun.ps1 shims that spawnSync cannot
// run without a shell. Resolve the real executable once instead of enabling a
// shell, which would reintroduce Node's DEP0190 warning for every call.
export function resolveBun(): string | null {
  if (resolvedBun !== undefined) return resolvedBun;
  if (process.platform !== "win32") {
    resolvedBun = run("bun", ["--version"], process.cwd(), true).ok ? "bun" : null;
    return resolvedBun;
  }
  const candidates: string[] = [];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    candidates.push(resolve(dir, "bun.exe"));
    if (existsSync(join(dir, "bun.cmd")) || existsSync(join(dir, "bun.ps1"))) {
      // npm's global prefix keeps the package inside the shim directory; some
      // layouts place it one level up instead. Probe both before giving up.
      candidates.push(resolve(dir, "node_modules", "bun", "bin", "bun.exe"));
      candidates.push(resolve(dir, "..", "node_modules", "bun", "bin", "bun.exe"));
    }
  }
  resolvedBun =
    candidates.find(
      (candidate) => existsSync(candidate) && run(candidate, ["--version"], process.cwd(), true).ok,
    ) ?? null;
  return resolvedBun;
}

export async function bootstrap(options: BootstrapOptions): Promise<void> {
  const { targetDir, flavor, install, db } = options;

  if (install) {
    const bun = resolveBun();
    if (!bun) {
      warn("bun is not on PATH. Install it from https://bun.sh and run the commands below.");
      printManual(targetDir, flavor, db);
      return;
    }
    step("Installing dependencies");
    if (!run(bun, ["install"], targetDir).ok) {
      warn("bun install failed.");
      printManual(targetDir, flavor, db);
      return;
    }
    step("Applying database migrations");
    if (!run(bun, ["run", "db:migrate"], targetDir).ok) {
      warn("Database migration failed.");
      printManual(targetDir, flavor, db);
      return;
    }
  }

  if (!install && db === "postgres") {
    warn("Set DATABASE_URL and apply migrations after installing dependencies:");
    console.log(`    cd ${quotePath(targetDir)}`);
    console.log("    bun install");
    console.log(`    ${postgresMigrationCommand()}`);
  }
  console.log("");
  console.log(styleText("green", "Done."));
  console.log(`    cd ${quotePath(targetDir)}`);
  console.log(`    ${devCommand(flavor)}`);
  console.log("    bun run test");
}
