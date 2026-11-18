import "reflect-metadata";
import {
  Catch,
  Global,
  HttpException,
  Module,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { ORPCModule } from "@orpc/nest";
import compress from "@fastify/compress";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Http2ServerRequest, Http2ServerResponse } from "node:http2";
import { join, relative, resolve, sep } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppDatabase } from "@server/schema";
import { NotesModule } from "@server/notes/notes.module";

// Nest wraps its own errors in HttpException; body errors raised by Fastify
// (malformed JSON, payload too large) arrive as plain errors with a statusCode.
const statusOf = (error: unknown) => {
  const status =
    error instanceof HttpException
      ? error.getStatus()
      : ((error as { statusCode?: unknown; status?: unknown } | null)?.statusCode ??
        (error as { status?: unknown } | null)?.status);
  return typeof status === "number" && status >= 400 && status <= 599 ? status : 500;
};

export async function createApp(
  db: AppDatabase,
  options: { serveClient?: boolean; clientDist?: string } = {},
) {
  const clientDist = resolve(options.clientDist ?? resolve(import.meta.dir, "../../client/dist"));
  @Global()
  @Module({ providers: [{ provide: "DATABASE", useValue: db }], exports: ["DATABASE"] })
  class DatabaseModule {}

  @Module({
    imports: [
      ORPCModule.forRoot({
        customErrorResponseBodyEncoder(error) {
          return { error: error.status >= 500 ? "Internal server error" : error.message };
        },
      }),
      DatabaseModule,
      NotesModule,
    ],
  })
  class AppModule {}

  async function notFound(request: FastifyRequest, reply: FastifyReply) {
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
          file.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
        return reply
          .type(target.type || "application/octet-stream")
          .send(Buffer.from(await target.arrayBuffer()));
      }
    }
    return reply.status(404).send({ error: "Not found" });
  }

  @Catch()
  class ErrorFilter implements ExceptionFilter {
    async catch(error: unknown, host: ArgumentsHost) {
      const request = host.switchToHttp().getRequest<FastifyRequest>();
      const reply = host.switchToHttp().getResponse<FastifyReply>();
      const status = statusOf(error);
      if (status === 400) return reply.status(400).send({ error: "Invalid JSON body" });
      if (status === 404) return notFound(request, reply);
      if (status >= 400 && status < 500) {
        const message = status === 413 ? "Payload too large" : "Request failed";
        return reply.status(status).send({ error: message });
      }
      console.error(error);
      return reply.status(500).send({ error: "Internal server error" });
    }
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      routerOptions: {
        onBadUrl(
          _path: string,
          _request: IncomingMessage | Http2ServerRequest,
          response: ServerResponse | Http2ServerResponse,
        ) {
          response.statusCode = 404;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: "Not found" }));
        },
      },
    }),
    { logger: false },
  );
  await app.register(compress);
  await app.getHttpAdapter().getInstance().after();
  if (options.serveClient) app.getHttpAdapter().getInstance().get("/*", notFound);
  app.useGlobalFilters(new ErrorFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
