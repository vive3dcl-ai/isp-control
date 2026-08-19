import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PublicRegisterDto } from '../tenants/dto/public-register.dto';
import { TenantsService } from '../tenants/tenants.service';

/**
 * Alta pública de empresa (landing). Reutiliza provisioning + activación de plan.
 * Sin JWT; rate-limit estricto.
 */
@Controller('public/platform')
export class PlatformRegisterPublicController {
  constructor(private readonly tenants: TenantsService) {}

  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async register(@Body() dto: PublicRegisterDto) {
    // Honeypot: bots que rellenan campos ocultos reciben éxito falso.
    if (dto.website?.trim()) {
      return {
        ok: true,
        tenant: { name: dto.name?.trim() || 'empresa', slug: 'ok' },
        owner: {
          email: (dto.ownerEmail || '').toLowerCase().trim(),
          name: dto.ownerName?.trim() || '',
        },
        plan: { code: dto.planCode, label: dto.planCode },
      };
    }

    if (
      dto.ownerPasswordConfirm != null &&
      dto.ownerPasswordConfirm !== dto.ownerPassword
    ) {
      throw new BadRequestException('Las contraseñas no coinciden');
    }

    try {
      return await this.tenants.registerPublic(dto);
    } catch (err) {
      if (err instanceof ConflictException) {
        const raw = err.getResponse();
        const msg = Array.isArray((raw as { message?: unknown }).message)
          ? String((raw as { message: string[] }).message[0] || '')
          : typeof raw === 'string'
            ? raw
            : String(
                (raw as { message?: string }).message || err.message || '',
              );
        if (/slug/i.test(msg)) {
          throw new ConflictException(
            'Ese identificador de empresa ya está en uso. Prueba otro slug.',
          );
        }
        if (/email|owner/i.test(msg)) {
          throw new ConflictException(
            'Ese email ya está registrado. Entra al panel o recupera la contraseña.',
          );
        }
        throw new ConflictException(
          'No se pudo completar el registro con esos datos.',
        );
      }
      throw err;
    }
  }
}
