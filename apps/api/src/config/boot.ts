/**
 * What must be true before `NestFactory.create` is called.
 *
 * **Every reason this process will not work is discovered before it is
 * listening.** An API that binds :4000 and then fails on the first save looks
 * healthy to a container runtime, gets traffic, and produces a user-facing error
 * for an operational fact that was already true when the process started.
 *
 * Called from `main.ts` before the Nest application exists, so a failure here is
 * a plain sentence on stderr rather than a framework stack with the one useful
 * line buried in the middle of it.
 */
import type { ApiConfig } from './config';

export class BootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootError';
  }
}

/**
 * The JSON body ceiling `main.ts` gives express. The largest body this API
 * accepts is a revision: a long-form post in markdown. 1 MB is a 150,000-word
 * essay, which no post in a blog is, and small enough that a flood of bodies
 * cannot exhaust memory.
 */
export const JSON_BODY_LIMIT_BYTES = 1_048_576;

export function assertConsistent(config: ApiConfig): void {
  // Sign-in is the credential-stuffing surface, so its budget is deliberately far
  // below the general one. A configuration where auth is the looser of the two
  // is almost certainly a copy-paste, and it is the exact mistake that turns a
  // rate limit into decoration.
  if (config.rateLimitAuth >= config.rateLimitGlobal) {
    throw new BootError(
      `RATE_LIMIT_AUTH (${String(config.rateLimitAuth)}) must be below RATE_LIMIT_GLOBAL ` +
        `(${String(config.rateLimitGlobal)}). Auth is the credential-stuffing surface; a budget ` +
        'at or above the general one is not a limit.',
    );
  }

  // Anonymous comments are the spam surface, and every one lands in a human's
  // moderation queue.
  if (config.rateLimitComment >= config.rateLimitGlobal) {
    throw new BootError(
      `RATE_LIMIT_COMMENT (${String(config.rateLimitComment)}) must be below RATE_LIMIT_GLOBAL ` +
        `(${String(config.rateLimitGlobal)}).`,
    );
  }
}

export function assertBootable(config: ApiConfig): void {
  assertConsistent(config);
}
