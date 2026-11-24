export const OPTIONS = [
  {
    flags: "--react",
    description: "Scaffold the React client (required without a TTY)",
    group: "flavor",
  },
  {
    flags: "--angular",
    description: "Scaffold the Angular client (required without a TTY)",
    group: "flavor",
  },
  { flags: "--zod", description: "Validate with Zod (default)", group: "schema" },
  { flags: "--effect", description: "Validate with Effect Schema", group: "schema" },
  { flags: "--sqlite", description: "Store data in SQLite (default)", group: "database" },
  { flags: "--postgres", description: "Store data in PostgreSQL", group: "database" },
  {
    flags: "--name <name>",
    description: "Project and npm package name (defaults to target directory without a TTY)",
  },
  { flags: "--no-install", description: "Skip bun install and the database migration" },
  { flags: "-h, --help", description: "Show this help" },
  { flags: "-v, --version", description: "Show the version" },
] as const;

const examples = [
  "npx lwapp --react my-app",
  "npx lwapp --angular my-app",
  "npx lwapp --react --effect my-app",
  "npx lwapp --react --postgres my-app",
];
const groups = ["flavor", "schema", "database"] as const;
const flags = groups.map((group) =>
  OPTIONS.filter((option) => "group" in option && option.group === group)
    .map((option) => option.flags)
    .join(" | "),
);
const singleFlags = OPTIONS.filter((option) => !("group" in option)).map((option) =>
  option.flags.replace(/^-[a-z], /, ""),
);

export const RECIPE = `lwapp needs a TTY for prompts. Non-interactive usage:
${examples.map((example) => `  ${example}`).join("\n")}
Flags: ${[...flags, ...singleFlags].join(", ")}`;

export const USAGE = `Usage: lwapp [options] [target-directory]

Options:
${OPTIONS.map(({ flags, description }) => `  ${flags.padEnd(18)} ${description}`).join("\n")}

Examples:
  npx lwapp
${examples.map((example) => `  ${example}`).join("\n")}`;
