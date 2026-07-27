import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformAccess } from '../auth/decorators/roles.decorator';
import { VpnService } from './vpn.service';

@Controller('admin/vpn')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class VpnAdminController {
  constructor(private readonly vpn: VpnService) {}

  /**
   * Conf completo del concentrador WireGuard multi-tenant (todos los peers).
   * Incluye PrivateKey del servidor — solo plataforma.
   */
  @Get('wireguard-concentrator')
  @Header('Cache-Control', 'no-store')
  getWireguardConcentrator() {
    return this.vpn.getWireguardConcentratorConfig();
  }

  /** Usuarios/CCD OpenVPN multi-tenant (MikroTik → VPN_PUBLIC_HOST). */
  @Get('openvpn-concentrator')
  @Header('Cache-Control', 'no-store')
  getOpenVpnConcentrator() {
    return this.vpn.getOpenVpnConcentratorConfig();
  }
}
