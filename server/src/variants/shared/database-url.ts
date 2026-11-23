export function databaseName(url: URL): string {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name) throw new Error("DATABASE_URL must name a database");
  return name;
}

export function isDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      url.hostname.length > 0 &&
      !/\s/.test(url.hostname) &&
      databaseName(url).length > 0
    );
  } catch {
    return false;
  }
}
