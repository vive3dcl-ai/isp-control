import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import {
  PlatformAccess,
  PlatformWriteAccess,
} from '../../auth/decorators/roles.decorator';
import {
  OnuCatalogAdminService,
  type UpsertOnuCatalogDto,
} from './onu-catalog-admin.service';

@Controller('admin/onus')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class OnuCatalogAdminController {
  constructor(private readonly catalog: OnuCatalogAdminService) {}

  @Get()
  list() {
    return this.catalog.list();
  }

  @Post()
  @PlatformWriteAccess()
  create(@Body() dto: UpsertOnuCatalogDto) {
    return this.catalog.create(dto);
  }

  @Patch(':id')
  @PlatformWriteAccess()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<UpsertOnuCatalogDto>,
  ) {
    return this.catalog.update(id, dto);
  }

  @Delete(':id')
  @PlatformWriteAccess()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.remove(id);
  }

  @Post('propagate')
  @PlatformWriteAccess()
  propagate() {
    return this.catalog.propagateToAllTenants();
  }

  @Post(':id/approve')
  @PlatformWriteAccess()
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.approve(id);
  }
}
