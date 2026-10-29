import { z } from 'zod';

import { emailSchema, idSchema, nameSchema } from './primitives';
import { roleSchema } from './roles';

/**
 * There is no sign-up. A CMS's accounts are people an admin invited to write, so
 * the only way in is an account that already exists (the seed, or an admin in
 * the studio). A public sign-up form on a newsroom's tool is an open door.
 */
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

/**
 * The user shape the web app puts in its session and mints tokens from.
 *
 * Auth.js callbacks PARSE with this rather than casting. A drifted API response
 * then produces no session at all, which is a visible failure, instead of a
 * session whose `id` is `undefined` -- and in Prisma `undefined` is not "no
 * rows", it is "no filter", so that session would silently read somebody else's
 * drafts.
 *
 * `role` here is for the studio's own rendering (which buttons to show). The API
 * never trusts it for an authorisation decision; it reads the role from the
 * users table, so a demotion takes effect on the next request, not at the next
 * sign-in.
 */
export const sessionUserSchema = z.object({
  id: idSchema,
  email: emailSchema,
  name: nameSchema,
  role: roleSchema,
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
