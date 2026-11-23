import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
for (const script of ["templates:sync", "build"]) {
  const result = spawnSync(process.execPath, ["run", script], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${script} failed before CLI tests`);
}
