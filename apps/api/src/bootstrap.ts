import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import type { Env } from "./config/env.js";

/** Builds the configured app (helmet, CORS, OpenAPI). Shared by `main.ts` and the e2e tests. */
export async function createApp(env: Env): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  // Only the dashboard origin may call the API from a browser.
  // A static `origin` string would be sent to every caller; this answers with it only when the request matches.
  const dashboardOrigin = new URL(env.DASHBOARD_BASE_URL).origin;
  app.enableCors({ origin: (origin, done) => done(null, origin === dashboardOrigin ? dashboardOrigin : false), credentials: true });
  app.disable("x-powered-by");

  if (env.NODE_ENV !== "production") {
    const config = new DocumentBuilder().setTitle("DevGuard API").setVersion("0.0.0").build();
    SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));
  }
  return app;
}
