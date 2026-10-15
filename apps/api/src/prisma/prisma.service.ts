import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { ENV } from "../config/env.token.js";
import type { Env } from "../config/env.js";
import { PrismaClient } from "./generated/client.js";

/** The only Prisma client. Injected into repositories; services and controllers never see it. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  public constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  public async onModuleInit(): Promise<void> {
    // Fail fast: never start without a database. With the pg adapter `$connect()` is lazy, so run a real query.
    await this.$queryRaw`SELECT 1`;
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
