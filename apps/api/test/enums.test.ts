import {
  ClassificationSchema,
  DeviceStatusSchema,
  EnforcementModeSchema,
  ExceptionStatusSchema,
  OperationTypeSchema,
  OutcomeSchema,
  RoleSchema,
} from "@devguard/shared";
import { describe, expect, it } from "vitest";
import * as Prisma from "../src/prisma/generated/enums.js";

/** The Prisma enums mirror the shared contracts; drift would let the DB accept values the contracts reject (or vice versa). */
describe("Prisma enums equal @devguard/shared enums", () => {
  it.each([
    ["Role", Prisma.Role, RoleSchema.options],
    ["Classification", Prisma.Classification, ClassificationSchema.options],
    ["EnforcementMode", Prisma.EnforcementMode, EnforcementModeSchema.options],
    ["Outcome", Prisma.Outcome, OutcomeSchema.options],
    ["OperationType", Prisma.OperationType, OperationTypeSchema.options],
    ["DeviceStatus", Prisma.DeviceStatus, DeviceStatusSchema.options],
    ["ExceptionStatus", Prisma.ExceptionStatus, ExceptionStatusSchema.options],
  ])("%s", (_name, prismaEnum, sharedOptions) => {
    expect(Object.values(prismaEnum).sort()).toEqual([...sharedOptions].sort());
  });
});
