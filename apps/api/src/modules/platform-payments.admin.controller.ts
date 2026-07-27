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
import { PlatformAccess } from '../auth/decorators/roles.decorator';
import { PlatformPaymentsService } from './platform-payments.service';
import { UpdatePlatformPaymentMethodDto } from './dto/modules.dto';

@Controller('admin/payment-methods')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class PlatformPaymentsAdminController {
  constructor(private readonly payments: PlatformPaymentsService) {}

  @Get()
  list() {
    return this.payments.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformPaymentMethodDto,
  ) {
    return this.payments.update(id, dto);
  }
}
