import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { RoleSchema } from "./enums.js";

export const LoginRequestSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RoleAssignmentSchema = z
  .object({ role: RoleSchema, projectId: IdSchema.nullable() })
  .strict();
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;

/** The signed-in dashboard user. Never carries credential material. */
export const SessionUserSchema = z
  .object({
    id: IdSchema,
    email: z.email(),
    name: z.string().min(1).max(200),
    roles: z.array(RoleAssignmentSchema),
    isAdmin: z.boolean(),
  })
  .strict();
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const PASSWORD_MIN_LENGTH = 12;

export const CreateUserRequestSchema = z
  .object({
    email: z.email().max(254),
    name: z.string().trim().min(1).max(200),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(256),
    isAdmin: z.boolean().default(false),
  })
  .strict();
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UserSummarySchema = z
  .object({
    id: IdSchema,
    email: z.email(),
    name: z.string(),
    status: z.enum(["active", "disabled"]),
    isAdmin: z.boolean(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type UserSummary = z.infer<typeof UserSummarySchema>;
