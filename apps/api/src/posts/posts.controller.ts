/**
 * `/studio/posts`: the editor's API. Session token, fresh role from the
 * database (`ActorGuard`), and the role table on every route. Ownership (an
 * author touches only their own posts) is the service's job, because it
 * depends on the row.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  createPostSchema,
  idSchema,
  renamePostSchema,
  restoreRevisionSchema,
  saveRevisionSchema,
  studioPostQuerySchema,
  transitionSchema,
  type CreatePostInput,
  type RevisionSummary,
  type RevisionView,
  type SaveRevisionInput,
  type StudioPost,
  type TransitionInput,
} from '@cms/shared';
import type { Response } from 'express';
import type { z } from 'zod';

import { Actor, Requires, type ActorRecord } from '../common/actor.guard';
import { ZodPipe } from '../common/zod.pipe';
import { PostsService } from './posts.service';

const id = new ZodPipe(idSchema);

@Controller('studio/posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Requires('post.read')
  @Get()
  list(
    @Actor() actor: ActorRecord,
    @Query(new ZodPipe(studioPostQuerySchema)) query: z.infer<typeof studioPostQuerySchema>,
  ) {
    return this.posts.list(actor, query);
  }

  @Requires('post.write')
  @Post()
  create(
    @Actor() actor: ActorRecord,
    @Body(new ZodPipe(createPostSchema)) input: CreatePostInput,
  ): Promise<StudioPost> {
    return this.posts.create(actor, input);
  }

  @Requires('post.read')
  @Get(':id')
  get(@Actor() actor: ActorRecord, @Param('id', id) postId: string): Promise<StudioPost> {
    return this.posts.get(actor, postId);
  }

  @Requires('post.read')
  @Get(':id/revisions')
  revisions(
    @Actor() actor: ActorRecord,
    @Param('id', id) postId: string,
  ): Promise<RevisionSummary[]> {
    return this.posts.revisions(actor, postId);
  }

  @Requires('post.read')
  @Get(':id/revisions/:revisionId')
  revision(
    @Actor() actor: ActorRecord,
    @Param('id', id) postId: string,
    @Param('revisionId', id) revisionId: string,
  ): Promise<RevisionView> {
    return this.posts.revision(actor, postId, revisionId);
  }

  /** 201 with the new head, or 200 when the text matched the head and nothing was written. */
  @Requires('post.write')
  @Post(':id/revisions')
  async save(
    @Actor() actor: ActorRecord,
    @Param('id', id) postId: string,
    @Body(new ZodPipe(saveRevisionSchema)) input: SaveRevisionInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StudioPost> {
    const result = await this.posts.save(actor, postId, input);
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.post;
  }

  @Requires('post.restore')
  @Post(':id/revisions/:revisionId/restore')
  async restore(
    @Actor() actor: ActorRecord,
    @Param('id', id) postId: string,
    @Param('revisionId', id) revisionId: string,
    @Body(new ZodPipe(restoreRevisionSchema)) input: z.infer<typeof restoreRevisionSchema>,
  ): Promise<StudioPost> {
    return (await this.posts.restore(actor, postId, revisionId, input.baseRevisionId)).post;
  }

  @Requires('post.write')
  @Put(':id/slug')
  rename(
    @Actor() actor: ActorRecord,
    @Param('id', id) postId: string,
    @Body(new ZodPipe(renamePostSchema)) input: z.infer<typeof renamePostSchema>,
  ): Promise<StudioPost> {
    return this.posts.rename(actor, postId, input.slug);
  }

  /** The action's own permission is checked in the service, from WORKFLOW. */
  @Requires('post.submit')
  @HttpCode(HttpStatus.OK)
  @Post(':id/transitions')
  transition(
    @Actor() actor: ActorRecord,
    @Param('id', id) postId: string,
    @Body(new ZodPipe(transitionSchema)) input: TransitionInput,
  ): Promise<StudioPost> {
    return this.posts.transition(actor, postId, input);
  }
}
