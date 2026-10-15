import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
import { createLoggerOptions } from "./common/logging/logger-options.js";
import type { Env } from "./config/env.js";
import { ENV } from "./config/env.token.js";
import { HealthModule } from "./modules/health/health.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";

@Module({})
export class AppModule {
  public static register(env: Env): DynamicModule {
    const { level, redact } = createLoggerOptions(env);
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: { level, redact: { paths: [...redact.paths], censor: redact.censor }, autoLogging: env.NODE_ENV !== "test" },
        }),
        ThrottlerModule.forRoot([{ ttl: env.THROTTLE_TTL_SECONDS * 1000, limit: env.THROTTLE_LIMIT }]),
        PrismaModule,
        HealthModule,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [ENV],
      global: true,
    };
  }
}
