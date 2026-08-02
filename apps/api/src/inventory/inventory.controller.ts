import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CRM_WRITE_ROLES,
  TenantRoles,
} from '../auth/decorators/tenant-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import type { AuthUser } from '../auth/auth.types';
import { InventoryService } from './inventory.service';
import {
  AdjustInventoryItemDto,
  CreateInventoryItemDto,
  INVENTORY_ITEM_TYPES,
  UpdateInventoryItemDto,
  type InventoryItemTypeDto,
} from './dto/inventory.dto';

@Controller('app/inventory/items')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: string,
    @Query('inStock') inStock?: string,
  ) {
    const normalized =
      type && (INVENTORY_ITEM_TYPES as readonly string[]).includes(type)
        ? (type as InventoryItemTypeDto)
        : undefined;
    return this.inventory.list(user, {
      type: normalized,
      inStock: inStock === '1' || inStock === 'true',
    });
  }

  @Post()
  @TenantRoles(...CRM_WRITE_ROLES)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInventoryItemDto) {
    return this.inventory.create(user, dto);
  }

  @Patch(':id')
  @TenantRoles(...CRM_WRITE_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return this.inventory.update(user, id, dto);
  }

  @Post(':id/adjust')
  @TenantRoles(...CRM_WRITE_ROLES)
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustInventoryItemDto,
  ) {
    return this.inventory.adjust(user, id, dto);
  }

  @Delete(':id')
  @TenantRoles(...CRM_WRITE_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inventory.remove(user, id);
  }
}
