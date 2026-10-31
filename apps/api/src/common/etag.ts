/**
 * ETags for the content API.
 *
 * Every `/v1` GET answers with a strong ETag over the exact JSON it would
 * send, and `Cache-Control: no-cache`: a client may keep the body but must
 * ask before using it. `If-None-Match` with a matching tag gets 304 and no
 * body. The public site revalidates its cache this way, so an unchanged post
 * costs a round trip of headers instead of the post.
 *
 * The tag is computed from the serialized body, not from a version column, so
 * it is right by construction: any change to anything in the response, a tag
 * renamed, an author's name corrected, changes it.
 */
import { createHash } from 'node:crypto';

import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';

export function etagOf(json: string): string {
  return `"${createHash('sha256').update(json, 'utf8').digest('base64url').slice(0, 27)}"`;
}

/**
 * Whether an `If-None-Match` header matches `etag`. Handles a list, `*` and
 * the weak prefix a proxy may add (RFC 9110 uses weak comparison here).
 */
export function matches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//u, '');
  return header.split(',').some((tag) => tag.trim() === '*' || bare(tag) === bare(etag));
}

@Injectable()
export class EtagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (request.method !== 'GET' || response.statusCode !== 200) return body;
        const json = JSON.stringify(body);
        const etag = etagOf(json);
        response.setHeader('ETag', etag);
        response.setHeader('Cache-Control', 'no-cache');
        if (matches(request.headers['if-none-match'], etag)) {
          response.status(304);
          return undefined;
        }
        return body;
      }),
    );
  }
}
