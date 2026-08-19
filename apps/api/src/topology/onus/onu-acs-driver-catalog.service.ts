import { Injectable, Logger } from '@nestjs/common';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import { OnuAcsDriver } from '../shared/entities/onu-acs-driver.entity';
import { normalizeOnuModelName } from './onu-model-catalog';

const LIBRARY_SEED: Array<{
  modelKey: string;
  family: string;
  libraryId: string;
}> = [
  { modelKey: 'HG9', family: 'tenda', libraryId: 'tenda-hg9' },
  { modelKey: 'HG8145X6', family: 'huawei_hgu', libraryId: 'huawei-hg8145x6' },
  { modelKey: 'HG6143D', family: 'fiberhome_hgu', libraryId: 'fiberhome-hg6143d' },
];

export function acsModelKey(
  acsModel?: string | null,
  onuType?: string | null,
): string | null {
  const acs = acsModel?.trim()
    ? normalizeOnuModelName(acsModel)
    : '';
  const olt = onuType?.trim() ? normalizeOnuModelName(onuType) : '';
  const key = acs || olt;
  return key || null;
}

@Injectable()
export class OnuAcsDriverCatalogService {
  private readonly logger = new Logger(OnuAcsDriverCatalogService.name);

  constructor(private readonly tenants: TenantConnectionService) {}

  private async repo(schema: string) {
    return this.tenants.getOnuAcsDriverRepository(schema);
  }

  async seedLibraries(schema: string): Promise<void> {
    const repo = await this.repo(schema);
    for (const row of LIBRARY_SEED) {
      const exists = await repo.findOne({ where: { modelKey: row.modelKey } });
      if (exists) continue;
      await repo.save(
        repo.create({
          modelKey: row.modelKey,
          family: row.family,
          libraryId: row.libraryId,
          source: 'seed',
          enabled: true,
          spv: {},
          playbook: [],
          faultsSkip: [],
        }),
      );
    }
  }

  async findByModel(
    schema: string,
    modelKey: string,
  ): Promise<OnuAcsDriver | null> {
    await this.seedLibraries(schema);
    const repo = await this.repo(schema);
    return repo.findOne({
      where: { modelKey, enabled: true },
    });
  }

  async recordLearned(opts: {
    schema: string;
    modelKey: string;
    family: string;
    sn?: string | null;
    wanPath?: string | null;
    vlanLeaf?: string | null;
    bindLeaf?: string | null;
    playbook?: string[];
    needsRebootAfterCreds?: boolean;
  }): Promise<OnuAcsDriver> {
    await this.seedLibraries(opts.schema);
    const repo = await this.repo(opts.schema);
    let row = await repo.findOne({ where: { modelKey: opts.modelKey } });
    if (row?.libraryId) {
      row.successCount += 1;
      return repo.save(row);
    }
    if (!row) {
      row = repo.create({
        modelKey: opts.modelKey,
        family: opts.family,
        source: 'learned',
        enabled: true,
        spv: {},
        playbook: opts.playbook ?? [],
        faultsSkip: [],
        wanPath: opts.wanPath ?? null,
        vlanLeaf: opts.vlanLeaf ?? null,
        bindLeaf: opts.bindLeaf ?? null,
        learnedFromSn: opts.sn ?? null,
        needsRebootAfterCreds: opts.needsRebootAfterCreds ?? false,
        successCount: 1,
      });
      this.logger.log(
        `driver ACS aprendido modelo=${opts.modelKey} familia=${opts.family}`,
      );
      return repo.save(row);
    }
    row.family = opts.family;
    row.wanPath = opts.wanPath ?? row.wanPath;
    row.vlanLeaf = opts.vlanLeaf ?? row.vlanLeaf;
    row.bindLeaf = opts.bindLeaf ?? row.bindLeaf;
    if (opts.playbook?.length) row.playbook = opts.playbook;
    row.successCount += 1;
    row.source = 'learned';
    return repo.save(row);
  }
}
