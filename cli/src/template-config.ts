export const DOTFILES: Record<string, string> = {
  ".gitattributes": "_gitattributes",
  ".gitignore": "_gitignore",
  ".npmrc": "_npmrc",
};

export type Flavor = "react" | "angular";
export type SchemaLib = "zod" | "effect";
export type DbEngine = "sqlite" | "postgres";
export const CLIENT_DIR: Record<Flavor, string> = { react: "client", angular: "client-angular" };
export const OVERLAY_SETS = ["effect-sqlite", "zod-postgres", "effect-postgres"] as const;
export type OverlaySet = (typeof OVERLAY_SETS)[number];

export function overlaySetFor(schema: SchemaLib, db: DbEngine): OverlaySet | null {
  if (db === "postgres") return schema === "effect" ? "effect-postgres" : "zod-postgres";
  return schema === "effect" ? "effect-sqlite" : null;
}
