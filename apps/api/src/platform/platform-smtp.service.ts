import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSmtpSettings } from './entities/platform-smtp-settings.entity';
import { UpdatePlatformSmtpDto } from './dto/platform-smtp.dto';

@Injectable()
export class PlatformSmtpService {
  constructor(
    @InjectRepository(PlatformSmtpSettings)
    private readonly repo: Repository<PlatformSmtpSettings>,
  ) {}

  async getOrCreate(): Promise<PlatformSmtpSettings> {
    const existing = await this.repo.find({
      take: 1,
      order: { createdAt: 'ASC' },
    });
    if (existing[0]) return existing[0];
    return this.repo.save(this.repo.create({}));
  }

  async getPublic() {
    const row = await this.getOrCreate();
    return {
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      fromEmail: row.fromEmail,
      fromName: row.fromName,
      hasPassword: !!row.password,
      password: '',
      configured: !!(row.host?.trim() && row.fromEmail?.trim()),
    };
  }

  async update(dto: UpdatePlatformSmtpDto) {
    const row = await this.getOrCreate();
    row.host = dto.host.trim();
    row.port = dto.port;
    row.secure = dto.secure;
    row.username = dto.username.trim();
    if (dto.password != null && dto.password !== '') {
      row.password = dto.password;
    }
    row.fromEmail = dto.fromEmail.trim();
    row.fromName = dto.fromName.trim();
    await this.repo.save(row);
    return this.getPublic();
  }
}
