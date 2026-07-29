import {
  Controller,
  Get,
  Header,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { secureSecretEquals } from '../auth/secure-compare';
import { VpnService } from './vpn.service';

/**
 * Sync del concentrador Docker → sin JWT de usuario.
 * Header: X-VPN-SYNC-SECRET = VPN_SYNC_SECRET
 */
@Controller('internal/vpn')
export class VpnInternalController {
  constructor(
    private readonly vpn: VpnService,
    private readonly config: ConfigService,
  ) {}

  @Get('concentrator-state')
  @Header('Cache-Control', 'no-store')
  getConcentratorState(
    @Headers('x-vpn-sync-secret') secret: string | undefined,
  ) {
    const expected = this.config.get<string>('VPN_SYNC_SECRET')?.trim();
    if (!secureSecretEquals(secret, expected)) {
      throw new UnauthorizedException('Invalid VPN sync secret');
    }
    return this.vpn.getConcentratorSyncState();
  }
}
