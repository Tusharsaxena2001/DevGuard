import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core";
import { getOptionsToken, getStorageToken, ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions, type ThrottlerStorage } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { STRICT_THROTTLE_KEY } from "./common/auth/decorators.js";
import { CLOCK, systemClock } from "./common/clock/clock.js";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter.js";
import { createLoggerOptions } from "./common/logging/logger-options.js";
import type { Env } from "./config/env.js";
import { ENV } from "./config/env.token.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { AgentModule } from "./modules/agent/agent.module.js";
import { DestinationsModule } from "./modules/destinations/destinations.module.js";
import { DevicesModule } from "./modules/devices/devices.module.js";
import { EventsModule } from "./modules/events/events.module.js";
import { ExceptionsModule } from "./modules/exceptions/exceptions.module.js";
import { FingerprintsModule } from "./modules/fingerprints/fingerprints.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { MetricsModule } from "./modules/metrics/metrics.module.js";
import { PoliciesModule } from "./modules/policies/policies.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { UsersModule } from "./modules/users/users.module.js";
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
        ThrottlerModule.forRoot([
          { name: "default", ttl: env.THROTTLE_TTL_SECONDS * 1000, limit: env.THROTTLE_LIMIT },
          // Tighter limit for login and enrollment; only applies to handlers tagged with @StrictThrottle().
          {
            name: "strict",
            ttl: env.THROTTLE_TTL_SECONDS * 1000,
            limit: env.AUTH_THROTTLE_LIMIT,
            skipIf: (context) => Reflect.getMetadata(STRICT_THROTTLE_KEY, context.getHandler()) !== true,
          },
        ]),
        PrismaModule,
        HealthModule,
        UsersModule,
        DevicesModule,
        AuthModule,
        ProjectsModule,
        DestinationsModule,
        FingerprintsModule,
        PoliciesModule,
        AgentModule,
        EventsModule,
        ExceptionsModule,
        AuditModule,
        MetricsModule,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: CLOCK, useValue: systemClock },
        // Built explicitly: ThrottlerGuard resolves `Reflector` from compiled decorator metadata, which is absent when the
        // API runs from source under tsx (`pnpm start:dev`).
        {
          provide: APP_GUARD,
          useFactory: (options: ThrottlerModuleOptions, storage: ThrottlerStorage, reflector: Reflector): ThrottlerGuard =>
            new ThrottlerGuard(options, storage, reflector),
          inject: [getOptionsToken(), getStorageToken(), Reflector],
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [ENV, CLOCK],
      global: true,
    };
  }
}
