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
import { join, relative, resolve, sep } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppDatabase } from "@server/db";
import { NotesModule } from "@server/notes/notes.module";

const clientDist = resolve(import.meta.dir, "../../client/dist");

export async function createApp(db: AppDatabase, options: { serveClient?: boolean } = {}) {
  @Global()
  @Module({ providers: [{ provide: "DATABASE", useValue: db }], exports: ["DATABASE"] })
  class DatabaseModule {}

  @Module({
    imports: [
      ORPCModule.forRoot({
        customErrorResponseBodyEncoder(error) {
          if (error.status === 400) return { error: "Note text must be 1-200 characters" };
          if (error.status === 503) return { error: "Notes are unavailable" };
          return { error: "Internal server error" };
        },
      }),
      DatabaseModule,
      NotesModule,
    ],
  })
  class AppModule {}

  @Catch()
  class ErrorFilter implements ExceptionFilter {
    async catch(error: unknown, host: ArgumentsHost) {
      const request = host.switchToHttp().getRequest<FastifyRequest>();
      const reply = host.switchToHttp().getResponse<FastifyReply>();
      const status = error instanceof HttpException ? error.getStatus() : 500;
      if (status === 400) return reply.status(400).send({ error: "Invalid JSON body" });
      if (status === 404) {
        const path = request.url.split("?")[0] ?? "/";
        if (path === "/api" || path.startsWith("/api/"))
          return reply.status(404).send({ error: "Not found" });
        if (options.serveClient && request.method === "GET") {
          const filePath = resolve(clientDist, `.${decodeURIComponent(path)}`);
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
      console.error(error);
      return reply.status(500).send({ error: "Internal server error" });
    }
  }

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  app.useGlobalFilters(new ErrorFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
