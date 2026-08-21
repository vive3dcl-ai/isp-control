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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  PlatformAccess,
  PlatformWriteAccess,
} from '../auth/decorators/roles.decorator';
import { PlatformAiCapabilitiesService } from '../ai/platform-ai-capabilities.service';
import {
  CreatePlatformAiCapabilityDto,
  UpdatePlatformAiCapabilityDto,
} from './dto/platform-ai-capability.dto';
import type { PlatformAiCapabilityKind } from './entities/platform-ai-capability.entity';

@Controller('admin/ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class PlatformAiAdminController {
  constructor(private readonly capabilities: PlatformAiCapabilitiesService) {}

  @Get('capabilities')
  list(@Query('kind') kind?: string) {
    const k =
      kind === 'tool' || kind === 'skill'
        ? (kind as PlatformAiCapabilityKind)
        : undefined;
    return this.capabilities.listAdmin(k);
  }

  @Get('capabilities/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.capabilities.getAdmin(id);
  }

  @Post('capabilities')
  @PlatformWriteAccess()
  create(@Body() dto: CreatePlatformAiCapabilityDto) {
    return this.capabilities.create(dto);
  }

  @Patch('capabilities/:id')
  @PlatformWriteAccess()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformAiCapabilityDto,
  ) {
    return this.capabilities.update(id, dto);
  }

  @Delete('capabilities/:id')
  @PlatformWriteAccess()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.capabilities.remove(id);
  }
}
