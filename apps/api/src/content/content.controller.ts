/**
 * `/v1`: the headless content API. `Authorization: Bearer hcms_...`, keyset
 * pagination, ETags (304 on `If-None-Match`). The public site is one client
 * among any others.
 */
import { Controller, Get, HttpStatus, Param, Query, Res, UseInterceptors } from '@nestjs/common';
import {
  slugSchema,
  v1PostQuerySchema,
  v1SearchQuerySchema,
  type V1Post,
  type V1PostQuery,
  type V1SearchQuery,
} from '@cms/shared';
import type { Response } from 'express';

import { ContentApi } from '../common/api-key.guard';
import { EtagInterceptor } from '../common/etag';
import { Public } from '../common/session.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ContentService } from './content.service';
import { openApiDocument } from './openapi';

@Controller('v1')
@UseInterceptors(EtagInterceptor)
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @ContentApi()
  @Get('posts')
  list(@Query(new ZodPipe(v1PostQuerySchema)) query: V1PostQuery) {
    return this.content.list(query);
  }

  /** 200 with the post; 308 (and the current slug) from an old one; 410 if taken down. */
  @ContentApi()
  @Get('posts/:slug')
  async get(
    @Param('slug', new ZodPipe(slugSchema)) slug: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<V1Post | { code: 'MOVED'; slug: string }> {
    const found = await this.content.get(slug);
    if (found.kind === 'post') return found.post;
    response.status(HttpStatus.PERMANENT_REDIRECT).setHeader('Location', `/v1/posts/${found.slug}`);
    return { code: 'MOVED', slug: found.slug };
  }

  @ContentApi()
  @Get('tags')
  async tags() {
    return { items: await this.content.tags() };
  }

  /** Live posts matching `q`, best first, each with a snippet as data (no HTML). */
  @ContentApi()
  @Get('search')
  search(@Query(new ZodPipe(v1SearchQuerySchema)) query: V1SearchQuery) {
    return this.content.search(query);
  }

  /** The API's own description. Public: it describes the shapes, it holds no content. */
  @Public()
  @Get('openapi.json')
  openapi() {
    return openApiDocument();
  }
}
