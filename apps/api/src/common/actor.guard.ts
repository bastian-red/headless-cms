/**
 * The role guard: who is asking, as the users table says NOW, and whether the
 * role table lets them.
 *
 * Runs after `SessionGuard` (which proved the token) and before the throttler.
 * The role comes from the row, never from the token: a token minted before an
 * admin demoted somebody still says "EDITOR" for up to two minutes, and an
 * editor's power must end on the next request, not at the next sign-in. That
 * costs one primary-key lookup per signed-in request.
 *
 * `@Requires(action)` names the action from `PERMISSIONS` in `@cms/shared`, the
 * same table the studio reads to decide which buttons to show. A route without
 * it still gets the fresh actor; ownership rules (an author edits only their
 * own posts) are data-dependent and live in the services.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, can, type Action, type Role } from '@cms/shared';

import { PrismaService } from '../infra/prisma.service';
import type { RequestWithUser } from './session.guard';

export const REQUIRES = 'cms:requires';

export const Requires = (action: Action): MethodDecorator => SetMetadata(REQUIRES, action);

/** The signed-in person, as stored now. */
export interface ActorRecord {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
}

export interface RequestWithActor extends RequestWithUser {
  actor?: ActorRecord;
}

/** The decision without a framework: `null` means allowed. */
export function refusal(actor: ActorRecord, action: Action | undefined): DomainError | null {
  if (action === undefined || can(actor.role, action)) return null;
  return new DomainError('FORBIDDEN', 'Your role does not allow that.');
}

@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    // Public routes and content API routes carry no session user.
    if (request.user === undefined) return true;

    const actor = await this.prisma.client.user.findUnique({
      where: { id: request.user.id },
      select: { id: true, name: true, role: true },
    });
    if (actor === null) throw new UnauthorizedException('That account no longer exists.');

    const action = this.reflector.getAllAndOverride<Action | undefined>(REQUIRES, [
      context.getHandler(),
      context.getClass(),
    ]);
    const refused = refusal(actor, action);
    if (refused !== null) throw refused;

    request.actor = actor;
    return true;
  }
}

/** The fresh actor, as a parameter. Throws if the guard did not run. */
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<RequestWithActor>();
  if (request.actor === undefined) {
    throw new UnauthorizedException('This endpoint needs a service token.');
  }
  return request.actor;
});
