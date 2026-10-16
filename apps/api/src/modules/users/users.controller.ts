import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateUserRequestSchema, type CreateUserRequest, type UserSummary } from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentUser, Roles } from "../../common/auth/decorators.js";
import type { UserPrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { UsersService } from "./users.service.js";

@ApiTags("users")
@Roles("security_admin")
@Controller(`${API_V1}/users`)
export class UsersController {
  public constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: "List users (admin)" })
  public list(): Promise<UserSummary[]> {
    return this.users.list();
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Create a user (admin)" })
  public create(@CurrentUser() actor: UserPrincipal, @Body(new ZodValidationPipe(CreateUserRequestSchema)) body: CreateUserRequest): Promise<UserSummary> {
    return this.users.create(actor, body);
  }
}
