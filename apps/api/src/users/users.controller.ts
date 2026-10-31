/**
 * `/studio/users`: the admin's list of people. There is no sign-up, so this
 * is the only way an account comes to exist outside the seed.
 *
 * A role change is a transaction that locks the admins first, so the last
 * admin cannot be demoted, including by two admins demoting each other at
 * the same moment: the second waits, then counts one admin, and is refused.
 */
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { USER_EMAIL_UNIQUE, violatedUniqueIndex } from '@cms/db';
import { DomainError, createUserSchema, idSchema, updateRoleSchema, type Role } from '@cms/shared';
import { hashPassword } from '@cms/shared/server';
import type { z } from 'zod';

import { Requires } from '../common/actor.guard';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/prisma.service';

const select = { id: true, email: true, name: true, role: true, createdAt: true } as const;

@Controller('studio/users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Requires('user.manage')
  @Get()
  list() {
    return this.prisma.client.user.findMany({ orderBy: { createdAt: 'asc' }, select });
  }

  @Requires('user.manage')
  @Post()
  async create(@Body(new ZodPipe(createUserSchema)) input: z.infer<typeof createUserSchema>) {
    try {
      return await this.prisma.client.user.create({
        data: {
          email: input.email,
          name: input.name,
          role: input.role,
          passwordHash: hashPassword(input.password),
        },
        select,
      });
    } catch (error) {
      if (violatedUniqueIndex(error, USER_EMAIL_UNIQUE)) {
        throw new DomainError('CONFLICT', 'There is already an account with that email address.');
      }
      throw error;
    }
  }

  @Requires('user.manage')
  @Patch(':id/role')
  setRole(
    @Param('id', new ZodPipe(idSchema)) id: string,
    @Body(new ZodPipe(updateRoleSchema)) input: { role: Role },
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const admins = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id }, select: { role: true } });
      if (target === null) throw new DomainError('NOT_FOUND', 'There is no such person.');
      if (target.role === 'ADMIN' && input.role !== 'ADMIN' && admins.length <= 1) {
        throw new DomainError(
          'UNPROCESSABLE',
          'This is the last admin. Make somebody else an admin first.',
        );
      }
      return tx.user.update({ where: { id }, data: { role: input.role }, select });
    });
  }
}
