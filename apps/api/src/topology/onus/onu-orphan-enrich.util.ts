/**
 * Helpers para enriquecer huérfanas (uncfg) con modelo ACS + driver.
 */
import { resolveOnuDriver } from '../../drivers/onu';
import {
  resolveAcsModelFromDevice,
  resolveAcsModelFromGenieId,
} from '../../drivers/onu/infra/resolve-acs-model';
import { vendorFromSn } from '../../drivers/onu/infra/vendor-from-sn';
import { usableOnuModelName } from '../onus/onu-model-catalog';
import {
  deviceIdMatchesSerial,
  resolveNbiBaseUrl,
  GenieAcsNbiClient,
  strVal,
  genieGet,
} from '../shared/genieacs-nbi.client';

function idString(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

/** Proyección mínima: evita bajar el árbol TR-069 completo (timeouts → sin modelo). */
export const ORPHAN_ACS_PROJECTION = [
  '_id',
  '_deviceId',
  'InternetGatewayDevice.DeviceInfo.ModelName',
  'InternetGatewayDevice.DeviceInfo.ProductClass',
  'InternetGatewayDevice.DeviceInfo.SerialNumber',
  'Device.DeviceInfo.ModelName',
  'Device.DeviceInfo.ProductClass',
  'Device.DeviceInfo.SerialNumber',
].join(',');

export type OrphanModelSource = 'acs' | 'sighting' | 'inventory' | null;

export type OrphanAcsEnrichment = {
  model: string | null;
  modelSource: OrphanModelSource;
  driverId: string | null;
  vendor: string;
};

/**
 * Mapa SN→modelo ACS consultando GenieACS una sola vez (proyección ligera).
 * Si el scan masivo falla o no matchea, completa con findBySerial por SN
 * (las huérfanas suelen ser pocas).
 */
export async function loadAcsModelsBySerial(
  sns: string[],
  opts?: {
    nbi?: GenieAcsNbiClient;
    findDevices?: () => Promise<Record<string, unknown>[]>;
    findBySerial?: (sn: string) => Promise<Record<string, unknown> | null>;
  },
): Promise<Map<string, string>> {
  const wanted = [
    ...new Set(sns.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ];
  const out = new Map<string, string>();
  if (!wanted.length) return out;

  const client = opts?.nbi ?? new GenieAcsNbiClient(resolveNbiBaseUrl());

  let devices: Record<string, unknown>[] = [];
  try {
    if (opts?.findDevices) {
      devices = await opts.findDevices();
    } else {
      devices = await client.findDevices({}, { projection: ORPHAN_ACS_PROJECTION });
    }
  } catch {
    devices = [];
  }

  const ingest = (device: Record<string, unknown>, snHint?: string) => {
    const modelRaw =
      resolveAcsModelFromDevice(device) ??
      resolveAcsModelFromGenieId(idString(device._id));
    const model = usableOnuModelName(modelRaw);
    if (!model) return;

    if (snHint) {
      const key = snHint.trim().toUpperCase();
      if (key && !out.has(key)) out.set(key, model);
      return;
    }

    const id = idString(device._id);
    const deviceId = device._deviceId;
    const serialLeaf =
      strVal(genieGet(device, 'InternetGatewayDevice.DeviceInfo.SerialNumber')) ??
      strVal(genieGet(device, 'Device.DeviceInfo.SerialNumber')) ??
      (deviceId && typeof deviceId === 'object'
        ? typeof (deviceId as Record<string, unknown>)._SerialNumber === 'string'
          ? String((deviceId as Record<string, unknown>)._SerialNumber)
          : null
        : null);

    for (const sn of wanted) {
      if (out.has(sn)) continue;
      if (deviceIdMatchesSerial(id, sn)) {
        out.set(sn, model);
        continue;
      }
      if (serialLeaf && deviceIdMatchesSerial(serialLeaf, sn)) {
        out.set(sn, model);
        continue;
      }
      if (serialLeaf?.toUpperCase() === sn) {
        out.set(sn, model);
      }
    }
  };

  for (const device of devices) ingest(device);

  const missing = wanted.filter((sn) => !out.has(sn));
  if (missing.length) {
    for (const sn of missing) {
      try {
        const device = opts?.findBySerial
          ? await opts.findBySerial(sn)
          : await client.findBySerial(sn);
        if (device) ingest(device, sn);
      } catch {
        /* siguiente SN */
      }
    }
  }

  return out;
}

export function enrichOrphanModel(
  sn: string,
  acsModel: string | null | undefined,
  opts?: {
    sightingModel?: string | null;
    inventoryModel?: string | null;
  },
): OrphanAcsEnrichment {
  const vendor = vendorFromSn(sn);
  const fromAcs = usableOnuModelName(acsModel);
  const fromSighting = usableOnuModelName(opts?.sightingModel);
  const fromInventory = usableOnuModelName(opts?.inventoryModel);
  const model = fromAcs || fromSighting || fromInventory || null;
  const modelSource: OrphanModelSource = fromAcs
    ? 'acs'
    : fromSighting
      ? 'sighting'
      : fromInventory
        ? 'inventory'
        : null;
  const driver = resolveOnuDriver({
    sn,
    onuType: model,
    acsModel: model,
  });
  return {
    model,
    modelSource,
    driverId: driver?.id ?? null,
    vendor: vendor === 'other' ? 'unknown' : vendor,
  };
}
