import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { UserDirectory } from './entities/user-directory.entity';
import { PlatformAdmin } from '../auth/entities/platform-admin.entity';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

export interface ProvisionTenantResult {
  tenant: Tenant;
  owner: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

/**
 * Shared tenant provisioning used by admin UI and public registration.
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(UserDirectory)
    private readonly directory: Repository<UserDirectory>,
    @InjectRepository(PlatformAdmin)
    private readonly platformAdmins: Repository<PlatformAdmin>,
    private readonly tenantConnections: TenantConnectionService,
  ) {}

  async provision(dto: CreateTenantDto): Promise<ProvisionTenantResult> {
    const name = dto.name.trim();
    const slug = this.normalizeSlug(dto.slug ?? this.slugify(name));
    const schemaName = `tenant_${slug}`;
    const ownerEmail = dto.ownerEmail.toLowerCase().trim();
    const ownerName = dto.ownerName.trim();

    if (!slug) {
      throw new BadRequestException('Could not derive a valid slug from name');
    }

    await this.assertAvailable(slug, schemaName, ownerEmail);

    const passwordHash = await bcrypt.hash(dto.ownerPassword, 10);

    let tenant = this.tenants.create({
      name,
      legalName: dto.legalName.trim(),
      phone: dto.phone.trim(),
      email: '',
      address: dto.address.trim(),
      city: '',
      country: '',
      taxId: '',
      legalRepresentative: '',
      currency: 'USD',
      slug,
      schemaName,
      status: 'active',
      enabledModules: ['smtp'],
    });
    tenant = await this.tenants.save(tenant);

    try {
      await this.tenantConnections.ensureTenantSchema(schemaName);

      const users = await this.tenantConnections.getUserRepository(schemaName);
      const owner = await users.save(
        users.create({
          email: ownerEmail,
          name: ownerName,
          role: 'owner',
          isActive: true,
          passwordHash,
        }),
      );

      await this.directory.save(
        this.directory.create({
          email: ownerEmail,
          tenantId: tenant.id,
          role: 'owner',
        }),
      );

      this.logger.log(`Provisioned tenant ${slug} (${schemaName})`);

      return {
        tenant,
        owner: {
          id: owner.id,
          email: owner.email,
          name: owner.name,
          role: owner.role,
        },
      };
    } catch (err) {
      this.logger.error(
        `Provisioning failed for ${slug}, rolling back public rows`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.rollbackPublic(tenant.id, ownerEmail);
      throw err;
    }
  }

  normalizeSlug(raw: string): string {
    return raw
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  slugify(name: string): string {
    return this.normalizeSlug(
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .toLowerCase(),
    );
  }

  private async assertAvailable(
    slug: string,
    schemaName: string,
    ownerEmail: string,
  ) {
    const [bySlug, bySchema, inDirectory, asAdmin] = await Promise.all([
      this.tenants.findOne({ where: { slug } }),
      this.tenants.findOne({ where: { schemaName } }),
      this.directory.findOne({ where: { email: ownerEmail } }),
      this.platformAdmins.findOne({ where: { email: ownerEmail } }),
    ]);

    if (bySlug || bySchema) {
      throw new ConflictException('Tenant slug already exists');
    }
    if (inDirectory || asAdmin) {
      throw new ConflictException('Owner email is already registered');
    }
  }

  private async rollbackPublic(tenantId: string, ownerEmail: string) {
    await this.directory.delete({ email: ownerEmail });
    await this.tenants.delete({ id: tenantId });
  }
}
