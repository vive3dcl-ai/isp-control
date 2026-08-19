import { normalizeOnuModelName } from '../../../../topology/onus/onu-model-catalog';
import { vendorFromSn } from '../../infra/vendor-from-sn';
import type { OnuModelProvisionMatchCtx } from '../../types';

const MODEL_RE = /^(HG|EG)8145X6/i;

export function isHuaweiHg8145x6Model(
  onuType?: string | null,
  acsModel?: string | null,
): boolean {
  return [onuType, acsModel]
    .map((raw) => (raw?.trim() ? normalizeOnuModelName(raw) : ''))
    .filter(Boolean)
    .some((m) => MODEL_RE.test(m));
}

export function matchesHuaweiHg8145x6(
  ctx: OnuModelProvisionMatchCtx,
): boolean {
  if (vendorFromSn(ctx.sn) !== 'huawei') return false;
  return isHuaweiHg8145x6Model(ctx.onuType, ctx.acsModel);
}
