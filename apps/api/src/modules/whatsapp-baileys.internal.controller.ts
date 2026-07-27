import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModulesService } from './modules.service';
import { WhatsAppBaileysStatusDto } from './dto/modules.dto';

/** Callbacks del sidecar Baileys (sin JWT; secreto compartido). */
@Controller('internal/whatsapp/baileys')
export class WhatsAppBaileysInternalController {
  constructor(
    private readonly modules: ModulesService,
    private readonly config: ConfigService,
  ) {}

  @Post('status')
  status(
    @Headers('x-wa-internal-secret') secret: string | undefined,
    @Body() dto: WhatsAppBaileysStatusDto,
  ) {
    const expected =
      this.config.get<string>('WHATSAPP_BAILEYS_SECRET') || '';
    if (!expected || secret !== expected) {
      throw new UnauthorizedException('Invalid WhatsApp internal secret');
    }
    return this.modules.handleBaileysStatusWebhook(dto);
  }
}
