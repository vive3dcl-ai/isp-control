import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  PlatformAccess,
  PlatformWriteAccess,
} from '../auth/decorators/roles.decorator';
import { ModulesService } from './modules.service';
import { FxService } from './fx.service';
import {
  UpdateModulePricingDto,
  UpdateTenantModulesDto,
} from './dto/modules.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class ModulesAdminController {
  constructor(
    private readonly modules: ModulesService,
    private readonly fx: FxService,
  ) {}

  @Get('modules/catalog')
  catalog() {
    return this.modules.listCatalog();
  }

  @Get('fx/usd-clp')
  usdClp() {
    return this.fx.getUsdClp();
  }

  @Patch('modules/:moduleId/pricing')
  @PlatformWriteAccess()
  updatePricing(
    @Param('moduleId') moduleId: string,
    @Body() dto: UpdateModulePricingDto,
  ) {
    return this.modules.updateModulePricing(moduleId, dto);
  }

  @Get('tenants/:id/modules')
  listTenantModules(@Param('id', ParseUUIDPipe) id: string) {
    return this.modules.listForTenantAdmin(id);
  }

  @Patch('tenants/:id/modules')
  @PlatformWriteAccess()
  updateTenantModules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantModulesDto,
  ) {
    return this.modules.updateTenantModules(id, dto);
  }
}
