import { confirm, input, select } from "@inquirer/prompts";
import { validateProjectName, type Flavor } from "./rename.ts";
import type { SchemaLib } from "./scaffold.ts";

export async function askProjectName(): Promise<string> {
  return input({
    message: "Project name:",
    default: "my-app",
    validate: (value) => validateProjectName(value) ?? true,
  });
}

export async function askFlavor(): Promise<Flavor> {
  return select<Flavor>({
    message: "Client framework:",
    choices: [
      { name: "React 19 (Vite+, TanStack Router and Query)", value: "react" },
      { name: "Angular 22 (Angular CLI, Signal Forms)", value: "angular" },
    ],
  });
}

export async function askDirectory(projectName: string): Promise<string> {
  return input({ message: "Target directory:", default: projectName });
}

export async function askSchemaLibrary(): Promise<SchemaLib> {
  return select<SchemaLib>({
    message: "Schema library:",
    default: "zod",
    choices: [
      { name: "Zod — default", value: "zod" },
      { name: "Effect Schema", value: "effect" },
    ],
  });
}

export async function confirmNonEmpty(targetDir: string): Promise<boolean> {
  return confirm({
    message: `Target directory ${targetDir} is not empty. Scaffold into it anyway?`,
    default: false,
  });
}
