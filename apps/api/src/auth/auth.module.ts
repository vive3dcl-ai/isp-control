import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PlatformAdmin } from './entities/platform-admin.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { UserDirectory } from '../tenants/entities/user-directory.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { DatabaseModule } from '../database/database.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [
    DatabaseModule,
    PlatformModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET')?.trim();
        if (
          !secret ||
          secret === 'change-me-in-production-use-a-long-random-string'
        ) {
          if (config.get('NODE_ENV') === 'production') {
            throw new Error(
              'JWT_SECRET debe estar definido con un valor seguro en producción',
            );
          }
        }
        return {
          secret:
            secret || 'change-me-in-production-use-a-long-random-string',
          signOptions: {
            expiresIn: config.get('JWT_EXPIRES_IN', '8h') as `${number}h`,
          },
        };
      },
    }),
    TypeOrmModule.forFeature([
      PlatformAdmin,
      UserDirectory,
      Tenant,
      PasswordResetToken,
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
