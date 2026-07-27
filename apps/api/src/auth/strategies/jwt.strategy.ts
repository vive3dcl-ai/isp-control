import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser, JwtPayload } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET')?.trim();
    if (
      (!secret ||
        secret === 'change-me-in-production-use-a-long-random-string') &&
      config.get('NODE_ENV') === 'production'
    ) {
      throw new Error(
        'JWT_SECRET debe estar definido con un valor seguro en producción',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        secret || 'change-me-in-production-use-a-long-random-string',
    });
  }

  validate(payload: JwtPayload): AuthUser {
    return payload;
  }
}
