import { normalizeOnuModelName } from '../../../../topology/onus/onu-model-catalog';
import { vendorFromSn } from '../../infra/vendor-from-sn';
import type { OnuModelProvisionMatchCtx } from '../../types';

const HGU_MODEL_RE = /^(HG8245|HG6244|HG8145|HG8010|EG8145|EG8247)/i;

export function isHuaweiHguVeipModel(
  onuType?: string | null,
  acsModel?: string | null,
): boolean {
  const models = [onuType, acsModel]
    .map((raw) => (raw?.trim() ? normalizeOnuModelName(raw) : ''))
    .filter(Boolean);
  if (!models.length) return true;
  return models.some((m) => HGU_MODEL_RE.test(m));
}

export function matchesHuaweiHguVeip(ctx: OnuModelProvisionMatchCtx): boolean {
  if (vendorFromSn(ctx.sn) !== 'huawei') return false;
  return isHuaweiHguVeipModel(ctx.onuType, ctx.acsModel);
}
