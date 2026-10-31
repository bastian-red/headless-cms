/**
 * The application graph.
 *
 * Four global guards, in order, each failing closed:
 *
 * 1. `SessionGuard`: every route needs a service token unless `@Public()`
 *    (content API routes are `@Public()` to it through `@ContentApi()`).
 * 2. `ApiKeyGuard`: a `@ContentApi()` route needs a live `hcms_` key.
 * 3. `ActorGuard`: a signed-in caller's role is read from the users table
 *    now, and `@Requires(action)` is checked against `PERMISSIONS`.
 * 4. `ThrottlerGuard`: the general budget everywhere, keyed by user, key or
 *    address (so the three guards above must run first); `auth` and `comment`
 *    add stricter ones where `@Budget` asks; health and status skip.
 */
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

import { API_CONFIG, type ApiConfig } from './config/config';
import { AuthController } from './auth/auth.controller';
import { ApiKeysController } from './api-keys/api-keys.controller';
import { AuthService } from './auth/auth.service';
import { ActorGuard } from './common/actor.guard';
import { ApiKeyGuard } from './common/api-key.guard';
import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';
import { ContentController } from './content/content.controller';
import { ContentService } from './content/content.service';
import { DomainErrorFilter } from './common/domain-error.filter';
import { SessionGuard } from './common/session.guard';
import { throttlers } from './common/throttle';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { InfraModule } from './infra/infra.module';
import { RedisService } from './infra/redis.service';
import { PostsController } from './posts/posts.controller';
import { PostsService } from './posts/posts.service';
import { StatusController } from './status/status.controller';
import { TagsController } from './tags/tags.controller';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    InfraModule,
    ThrottlerModule.forRootAsync({
      inject: [API_CONFIG, RedisService],
      useFactory: (config: ApiConfig, redis: RedisService) => ({
        throttlers: throttlers(config),
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),
  ],
  controllers: [
    AuthController,
    HealthController,
    StatusController,
    PostsController,
    TagsController,
    UsersController,
    ApiKeysController,
    ContentController,
    CommentsController,
  ],
  providers: [
    AuthService,
    HealthService,
    PostsService,
    ContentService,
    CommentsService,
    // Registration order is execution order.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: ActorGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
