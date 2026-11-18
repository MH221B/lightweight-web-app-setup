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
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppDatabase } from "@server/schema";
import { createNotFoundHandler } from "@server/hosting";
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
  const notFound = createNotFoundHandler(options);
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
