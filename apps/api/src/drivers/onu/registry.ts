/**
 * Registry ONU — modelos específicos primero, luego genéricos por marca.
 * Cada entrada es un paquete en `models/<id>/`.
 */
import { normalizeOnuModelName } from '../../topology/onus/onu-model-catalog';
import { vendorFromSn } from './infra/vendor-from-sn';
import { fiberhomeHg6143dHandler } from './models/fiberhome-hg6143d';
import { genericFiberhomeDriver } from './models/generic-fiberhome';
import { genericHuaweiDriver } from './models/generic-huawei';
import { genericTendaDriver } from './models/generic-tenda';
import { genericUnknownDriver } from './models/generic-unknown';
import { genericZteDriver } from './models/generic-zte';
import { isTendaSn } from './models/tenda-hg9/match';
import { huaweiHg8145x6Handler } from './models/huawei-hg8145x6';
import { huaweiHguVeipHandler } from './models/huawei-hgu-veip';
import { tendaHg9Handler } from './models/tenda-hg9';
import type { OnuDriver, OnuModelProvisionMatchCtx } from './types';
import { driverSkipsOmciServiceWan } from './types';

/** Modelos específicos (orden: más específico primero). */
export const ONU_MODEL_DRIVERS: OnuDriver[] = [
  huaweiHg8145x6Handler,
  fiberhomeHg6143dHandler,
  tendaHg9Handler,
  huaweiHguVeipHandler,
];

/** Genéricos = modelos más (fallback por vendor SN). */
export const ONU_GENERIC_DRIVERS: OnuDriver[] = [
  genericHuaweiDriver,
  genericZteDriver,
  genericFiberhomeDriver,
  genericTendaDriver,
  genericUnknownDriver,
];

/** @deprecated Use ONU_MODEL_DRIVERS */
export const ONU_LIBRARY_DRIVERS = ONU_MODEL_DRIVERS;
/** @deprecated Use ONU_GENERIC_DRIVERS */
export const ONU_BRAND_GENERICS = ONU_GENERIC_DRIVERS;
/** @deprecated Use ONU_MODEL_DRIVERS */
export const ONU_MODEL_PROVISION_HANDLERS = ONU_MODEL_DRIVERS;

function normalizeCtx(
  ctx: OnuModelProvisionMatchCtx,
): OnuModelProvisionMatchCtx {
  const sn = ctx.sn?.trim() ?? '';
  return {
    sn,
    onuType: ctx.onuType ? normalizeOnuModelName(ctx.onuType) : ctx.onuType,
    acsModel: ctx.acsModel
      ? normalizeOnuModelName(ctx.acsModel)
      : ctx.acsModel,
  };
}

/**
 * Resuelve el driver ONU: modelo específico → genérico por marca.
 * Nunca null si hay SN (cae en generic-unknown).
 */
export function resolveOnuDriver(
  ctx: OnuModelProvisionMatchCtx,
): OnuDriver | null {
  const sn = ctx.sn?.trim();
  if (!sn) return null;
  const normalized = normalizeCtx(ctx);
  const model = ONU_MODEL_DRIVERS.find((d) => d.matches(normalized));
  if (model) return model;
  const vendor = vendorFromSn(sn);
  if (vendor === 'huawei') return genericHuaweiDriver;
  if (vendor === 'zte') return genericZteDriver;
  if (vendor === 'fiberhome') return genericFiberhomeDriver;
  if (isTendaSn(sn)) return genericTendaDriver;
  return genericUnknownDriver;
}

export function syntheticSnForVendor(
  vendor: string | null | undefined,
): string {
  const v = (vendor ?? '').trim().toLowerCase();
  if (v === 'huawei') return 'HWTC00000000';
  if (v === 'zte') return 'ZTEG00000000';
  if (v === 'fiberhome') return 'FHTT00000000';
  return 'XXXX00000000';
}

export type OnuDriverPreview = {
  provisionScriptId: string;
  provisionScriptLabel: string;
  provisionScriptKind: 'library' | 'generic';
  skipOmciServiceWan: boolean;
};

export function resolveOnuDriverForModel(opts: {
  vendor?: string | null;
  model?: string | null;
}): OnuDriverPreview {
  const model = opts.model?.trim()
    ? normalizeOnuModelName(opts.model)
    : null;
  let vendor = (opts.vendor ?? '').trim().toLowerCase();
  if (!vendor || vendor === 'other') {
    vendor = 'other';
  }
  const sn = syntheticSnForVendor(vendor);
  const driver =
    resolveOnuDriver({
      sn,
      onuType: model,
      acsModel: model,
    }) ?? genericUnknownDriver;

  const kind: 'library' | 'generic' = driver.id.startsWith('generic-')
    ? 'generic'
    : 'library';
  const label =
    kind === 'library'
      ? `Script específico · ${driver.id}`
      : `Genérico · ${driver.brand}`;

  return {
    provisionScriptId: driver.id,
    provisionScriptLabel: label,
    provisionScriptKind: kind,
    skipOmciServiceWan: driverSkipsOmciServiceWan(driver),
  };
}

/** Solo modelos específicos (null si caería en genérico). */
export function resolveOnuModelHandler(
  ctx: OnuModelProvisionMatchCtx,
): OnuDriver | null {
  const sn = ctx.sn?.trim();
  if (!sn) return null;
  const normalized = normalizeCtx(ctx);
  return ONU_MODEL_DRIVERS.find((d) => d.matches(normalized)) ?? null;
}

export function libraryOwnsWanSelection(
  ctx: OnuModelProvisionMatchCtx,
): OnuDriver | null {
  const sn = ctx.sn?.trim();
  if (!sn) return null;
  const normalized = normalizeCtx(ctx);
  const library = ONU_MODEL_DRIVERS.find((d) => d.matches(normalized));
  if (!library) return null;
  if (driverSkipsOmciServiceWan(library)) return library;
  if (library.ownsWanSelection?.(normalized)) return library;
  return null;
}
