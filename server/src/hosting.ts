import { join, relative, resolve, sep } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

// Build tools put a content hash in the file name. Vite keeps them under
// assets/ (index-9f2c1a7b.js); Angular emits them at the output root
// (main-FMDDPCTC.js). A hash segment is 8+ bare alphanumerics after a
// separator, followed by an extension bundlers emit hashed output for.
// Ordinary names stay no-cache: app-settings.json fails the extension
// gate, service-worker.js fails the length gate on "worker".
const HASHED_BUILD_FILE =
  /[.-][A-Za-z0-9]{8,}\.(?:js|mjs|css|map|woff2?|ico|png|jpe?g|gif|webp|svg|avif)$/;

function isImmutable(file: string): boolean {
  return file.startsWith("assets/") || HASHED_BUILD_FILE.test(file);
}

export function createNotFoundHandler(options: { serveClient?: boolean; clientDist?: string }) {
  const clientDist = resolve(options.clientDist ?? resolve(import.meta.dir, "../../client/dist"));

  return async function notFound(request: FastifyRequest, reply: FastifyReply) {
    const path = request.url.split("?")[0] ?? "/";
    if (path === "/api" || path.startsWith("/api/"))
      return reply.status(404).send({ error: "Not found" });
    if (options.serveClient && request.method === "GET") {
      let decoded: string;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
      const filePath = resolve(clientDist, `.${decoded}`);
      const file = Bun.file(
        filePath.startsWith(clientDist + sep) ? filePath : join(clientDist, "index.html"),
      );
      const target = (await file.exists()) ? file : Bun.file(join(clientDist, "index.html"));
      if (await target.exists()) {
        const file = relative(clientDist, target.name ?? "").replaceAll("\\", "/");
        reply.header(
          "Cache-Control",
          isImmutable(file) ? "public, max-age=31536000, immutable" : "no-cache",
        );
        return reply
          .type(target.type || "application/octet-stream")
          .send(Buffer.from(await target.arrayBuffer()));
      }
    }
    return reply.status(404).send({ error: "Not found" });
  };
}
