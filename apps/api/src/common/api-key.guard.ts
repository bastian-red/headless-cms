/**
 * The content API's credential: `Authorization: Bearer hcms_...`.
 *
 * `@ContentApi()` marks a route as part of `/v1`. It is public to the session
 * guard (a content client has no studio session) and closed here instead:
 * no key, a malformed key, an unknown key or a revoked key is the same 401
 * with the same sentence. A shape check runs before the lookup, so a token
 * meant for the studio never reaches the database.
 *
 * `last_used_at` is written at most once a minute per key, from memory, so
 * the read API does not become a write per request.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hashApiKey, looksLikeApiKey, readBearer } from '@cms/shared/server';

import { PrismaService } from '../infra/prisma.service';
import { IS_PUBLIC, type RequestWithUser } from './session.guard';

export const CONTENT_API = 'cms:contentApi';

export const ContentApi = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(IS_PUBLIC, true), SetMetadata(CONTENT_API, true));

export interface RequestWithApiKey extends RequestWithUser {
  apiKey?: { readonly id: string };
}

const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly touched = new Map<string, number>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isContentApi = this.reflector.getAllAndOverride<boolean>(CONTENT_API, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isContentApi !== true) return true;

    const request = context.switchToHttp().getRequest<RequestWithApiKey>();
    const key = readBearer(request.headers.authorization);
    if (key === null || !looksLikeApiKey(key)) throw refused();

    const row = await this.prisma.client.apiKey.findUnique({
      where: { keyHash: hashApiKey(key) },
      select: { id: true, revokedAt: true },
    });
    if (row === null || row.revokedAt !== null) throw refused();

    request.apiKey = { id: row.id };
    this.touch(row.id);
    return true;
  }

  private touch(id: string): void {
    const now = Date.now();
    if (now - (this.touched.get(id) ?? 0) < TOUCH_INTERVAL_MS) return;
    this.touched.set(id, now);
    this.prisma.client.apiKey
      .update({ where: { id }, data: { lastUsedAt: new Date(now) } })
      .catch((error: unknown) => console.warn('[api] could not record key use', error));
  }
}

function refused(): UnauthorizedException {
  return new UnauthorizedException('That API key was not accepted.');
}
