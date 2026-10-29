/**
 * The application graph.
 *
 * Two global guards, in order, each failing closed:
 *
 * 1. `SessionGuard`: every route needs a service token unless `@Public()`.
 * 2. `ThrottlerGuard`: the general budget everywhere; `auth` and `comment` add
 *    stricter ones where `@Budget` asks; health and status skip.
 *
 * The role guard (`@Requires(action)` against `PERMISSIONS`) joins them in build
 * step 4, when the first route that needs more than a signed-in user exists.
 */
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

import { API_CONFIG, type ApiConfig } from './config/config';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { DomainErrorFilter } from './common/domain-error.filter';
import { SessionGuard } from './common/session.guard';
import { throttlers } from './common/throttle';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { InfraModule } from './infra/infra.module';
import { RedisService } from './infra/redis.service';
import { StatusController } from './status/status.controller';

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
  controllers: [AuthController, HealthController, StatusController],
  providers: [
    AuthService,
    HealthService,
    // Registration order is execution order.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
