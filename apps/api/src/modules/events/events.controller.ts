import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  EventQuerySchema,
  SecurityEventBatchSchema,
  type EventBatchResult,
  type EventPage,
  type EventQuery,
  type SecurityEventBatch,
  type SecurityEventEntry,
} from "@devguard/shared";
import { API_V1 } from "../../common/api-version.js";
import { CurrentDevice, CurrentUser, DeviceAuth } from "../../common/auth/decorators.js";
import type { DevicePrincipal, UserPrincipal } from "../../common/auth/principals.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { EventsService } from "./events.service.js";

@ApiTags("events")
@Controller(API_V1)
export class EventsController {
  public constructor(@Inject(EventsService) private readonly events: EventsService) {}

  @Post("agent/events")
  @DeviceAuth()
  @HttpCode(200)
  @ApiOperation({ summary: "Deliver a batch of security events (device). Identity comes from the credential; unknown fields are rejected." })
  public ingest(@CurrentDevice() device: DevicePrincipal, @Body(new ZodValidationPipe(SecurityEventBatchSchema)) body: SecurityEventBatch): Promise<EventBatchResult> {
    return this.events.ingest(device, body);
  }

  @Get("events")
  @ApiOperation({ summary: "List events, newest first: all for admins, own for everyone else. An event shows what the hook observed and decided, not that data left or stayed." })
  public list(@CurrentUser() actor: UserPrincipal, @Query(new ZodValidationPipe(EventQuerySchema)) query: EventQuery): Promise<EventPage> {
    return this.events.list(actor, query);
  }

  @Get("events/:id")
  @ApiOperation({ summary: "One event (admin, or the user it belongs to)" })
  public get(@CurrentUser() actor: UserPrincipal, @Param("id", new ZodValidationPipe(z.uuid())) id: string): Promise<SecurityEventEntry> {
    return this.events.get(actor, id);
  }
}
