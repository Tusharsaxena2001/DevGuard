import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";

@Injectable()
export class HealthRepository {
  public constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** True when the database answers a trivial query. Errors are swallowed: they can contain connection details. */
  public async isDatabaseReachable(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
