/**
 * `/studio/api-keys`: content API keys, admin only.
 *
 * The key is in exactly one response, the one that creates it, and is stored
 * only as a SHA-256 (`@cms/shared/server` api-key.ts). Revoking keeps the row,
 * so the studio can still show who made a key and when it was last used.
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { DomainError, createApiKeySchema, idSchema } from '@cms/shared';
import { generateApiKey } from '@cms/shared/server';
import type { z } from 'zod';

import { Actor, Requires, type ActorRecord } from '../common/actor.guard';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/prisma.service';

const select = {
  id: true,
  name: true,
  prefix: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

@Controller('studio/api-keys')
export class ApiKeysController {
  constructor(private readonly prisma: PrismaService) {}

  @Requires('apikey.manage')
  @Get()
  list() {
    return this.prisma.client.apiKey.findMany({ orderBy: { createdAt: 'desc' }, select });
  }

  @Requires('apikey.manage')
  @Post()
  async create(
    @Actor() actor: ActorRecord,
    @Body(new ZodPipe(createApiKeySchema)) input: z.infer<typeof createApiKeySchema>,
  ) {
    const { key, prefix, keyHash } = generateApiKey();
    const apiKey = await this.prisma.client.apiKey.create({
      data: { name: input.name, prefix, keyHash, createdById: actor.id },
      select,
    });
    return { key, apiKey };
  }

  @Requires('apikey.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async revoke(@Param('id', new ZodPipe(idSchema)) id: string): Promise<void> {
    const { count } = await this.prisma.client.apiKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      const exists = await this.prisma.client.apiKey.count({ where: { id } });
      if (exists === 0) throw new DomainError('NOT_FOUND', 'There is no such key.');
    }
  }
}
