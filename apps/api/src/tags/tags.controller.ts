/**
 * `/studio/tags`. Any signed-in writer can list them (to pick from); creating
 * one is an editor's call, so the taxonomy stays a short list readers can
 * browse instead of one tag per post.
 */
import { Body, Controller, Get, Post } from '@nestjs/common';
import { TAG_NAME_UNIQUE, TAG_SLUG_UNIQUE, violatedUniqueIndex } from '@cms/db';
import { DomainError, createTagSchema, slugify } from '@cms/shared';
import type { z } from 'zod';

import { Requires } from '../common/actor.guard';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/prisma.service';

const select = { id: true, slug: true, name: true, description: true } as const;

@Controller('studio/tags')
export class TagsController {
  constructor(private readonly prisma: PrismaService) {}

  @Requires('post.read')
  @Get()
  list() {
    return this.prisma.client.tag.findMany({ orderBy: { name: 'asc' }, select });
  }

  @Requires('tag.manage')
  @Post()
  async create(@Body(new ZodPipe(createTagSchema)) input: z.infer<typeof createTagSchema>) {
    const slug = input.slug ?? slugify(input.name);
    if (slug === null) {
      throw new DomainError('UNPROCESSABLE', 'That name makes no slug; give the tag one.');
    }
    try {
      return await this.prisma.client.tag.create({
        data: { slug, name: input.name, description: input.description },
        select,
      });
    } catch (error) {
      if (
        violatedUniqueIndex(error, TAG_SLUG_UNIQUE) ||
        violatedUniqueIndex(error, TAG_NAME_UNIQUE)
      ) {
        throw new DomainError('CONFLICT', 'A tag with that name or slug already exists.');
      }
      throw error;
    }
  }
}
