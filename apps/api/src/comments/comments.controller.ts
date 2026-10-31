/**
 * Comments, from both sides.
 *
 * - `POST /comments`: a reader's submission. Public (no account), on the
 *   `comment` budget (RATE_LIMIT_COMMENT a minute per address, keyed by its
 *   hash), answered 202: accepted, and waiting for an editor.
 * - `GET /studio/comments` and `POST /studio/comments/:id/decision`: the
 *   moderation queue and an editor's decision (`comment.moderate`).
 *
 * The public read of approved comments is the content API's
 * (`GET /v1/posts/:slug/comments`, `ContentController`).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  idSchema,
  moderateCommentSchema,
  moderationQuerySchema,
  submitCommentSchema,
  type ModerateCommentInput,
  type ModerationQuery,
  type SubmitCommentInput,
} from '@cms/shared';
import type { Request } from 'express';

import { Actor, Requires, type ActorRecord } from '../common/actor.guard';
import { Public } from '../common/session.guard';
import { Budget } from '../common/throttle';
import { ZodPipe } from '../common/zod.pipe';
import { CommentsService } from './comments.service';

@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Public()
  @Budget('comment')
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('comments')
  submit(
    @Body(new ZodPipe(submitCommentSchema)) input: SubmitCommentInput,
    @Req() request: Request,
  ) {
    // `trust proxy` is one hop, so this is the address the web server forwarded.
    return this.comments.submit(input, request.ip ?? 'unknown');
  }

  @Requires('comment.moderate')
  @Get('studio/comments')
  queue(@Query(new ZodPipe(moderationQuerySchema)) query: ModerationQuery) {
    return this.comments.queue(query);
  }

  @Requires('comment.moderate')
  @HttpCode(HttpStatus.OK)
  @Post('studio/comments/:id/decision')
  decide(
    @Param('id', new ZodPipe(idSchema)) id: string,
    @Body(new ZodPipe(moderateCommentSchema)) input: ModerateCommentInput,
    @Actor() actor: ActorRecord,
  ) {
    return this.comments.decide(id, input, actor);
  }
}
