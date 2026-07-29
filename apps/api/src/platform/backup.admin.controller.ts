import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BackupService } from './backup.service';

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MB

type UploadedBackupFile = {
  path?: string;
  originalname?: string;
};

@Controller('admin/backup')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupAdminController {
  constructor(private readonly backup: BackupService) {}

  @Get('download')
  @Roles('superadmin')
  async download(@Res({ passthrough: true }) res: Response) {
    const { stream, filename } = await this.backup.createDump();
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(stream);
  }

  @Post('restore')
  @Roles('superadmin')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: tmpdir(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async restore(
    @UploadedFile() file: UploadedBackupFile | undefined,
    @Body('confirm') confirm?: string,
  ) {
    if (confirm !== 'RESTORE') {
      throw new BadRequestException(
        'Debes confirmar con confirm=RESTORE para restaurar.',
      );
    }
    if (!file?.path) {
      throw new BadRequestException(
        'Falta el archivo de respaldo (campo file).',
      );
    }

    try {
      const result = await this.backup.restoreFromFile(file.path);
      return {
        ok: true as const,
        message:
          'Restauración completada. Recarga el panel; si hay errores de sesión, reinicia el contenedor API.',
        warnings: result.warnings || undefined,
      };
    } finally {
      await fs.unlink(file.path).catch(() => undefined);
    }
  }
}
