/**
 * Provision HGU Huawei VEIP (monolito migrado; verify es un tick de ensureServiceWan).
 */
import {
  genieChildIndices,
  type GenieAcsNbiClient,
} from '../../../../topology/shared/genieacs-nbi.client';
import type {
  OnuModelProvisionCtx,
  OnuModelProvisionResult,
} from '../../types';
import {
  buildHuaweiServiceWanParams,
  expectedHuaweiDns,
  findHuaweiInternetWan,
  findReusableBlankHuaweiWan,
  isServiceWanApplied,
  listHuaweiWanIpConnections,
  needsNewWanConnectionDevice,
  resolveNewWanConnection,
  pickWanConnectionDevice,
  type HuaweiWanConnSummary,
} from './wan';

const WAN_DEV = 'InternetGatewayDevice.WANDevice';

async function refreshWanTree(
  client: GenieAcsNbiClient,
  deviceId: string,
): Promise<void> {
  try {
    await client.refreshObject(deviceId, WAN_DEV);
  } catch {
    /* seguimos con lo que haya */
  }
}

async function createServiceWanConnection(
  ctx: OnuModelProvisionCtx,
  device: Record<string, unknown>,
  conns: HuaweiWanConnSummary[],
  notes: string[],
): Promise<
  | { ok: true; device: Record<string, unknown>; notes: string[] }
  | { ok: false; notes: string[] }
> {
  const { client, deviceId } = ctx;
  const enqueueOnly = !!ctx.enqueueOnly;
  const addOpts = enqueueOnly
    ? { connectionRequest: false as const }
    : undefined;
  let current = device;

  // HG8145X6: AddObject bajo el WCD de TR069 → Invalid parameter path.
  // Crear un WANConnectionDevice nuevo es el camino válido.
  if (needsNewWanConnectionDevice(conns)) {
    const wcdBase = `${WAN_DEV}.1.WANConnectionDevice`;
    notes.push(
      `1/3 AddObject ${wcdBase} (nuevo WCD; TR069/OTHER ya ocupan los existentes)`,
    );
    try {
      const add = await client.addObject(deviceId, wcdBase, addOpts);
      notes.push(
        add.status === 200
          ? 'WANConnectionDevice creado'
          : `WANConnectionDevice encolado (status ${add.status})`,
      );
    } catch (e) {
      return {
        ok: false,
        notes: [
          ...notes,
          `AddObject WCD falló: ${e instanceof Error ? e.message : String(e)}`,
        ],
      };
    }
    if (enqueueOnly) {
      // No AddObject WANIP bajo un WCD viejo (árbol stale → caería en TR069).
      // El CPE suele crear WANIPConnection.1 al aplicar el AddObject del WCD.
      const cds = genieChildIndices(current, wcdBase);
      const nextCd = Math.max(0, ...cds, ...conns.map((c) => c.cd)) + 1;
      notes.push(
        `2/3 WANIPConnection.1 auto en WCD.${nextCd} (Inform post-reboot)`,
      );
      return { ok: true, device: current, notes };
    }
    await refreshWanTree(client, deviceId);
    current = (await client.findBySerial(ctx.sn)) ?? current;
    const after = listHuaweiWanIpConnections(current);
    if (resolveNewWanConnection(conns, after)) {
      return { ok: true, device: current, notes };
    }
    notes.push(
      'WCD sin WANIPConnection visible aún; reintento bajo el WCD nuevo',
    );
  }

  const connDevice = (() => {
    const after = listHuaweiWanIpConnections(current);
    const beforeKeys = new Set(conns.map((c) => c.connDevice));
    const freshCd = after.find((c) => !beforeKeys.has(c.connDevice));
    if (freshCd) return freshCd.connDevice;
    // Si creamos WCD pero aún no hay IPConnection en el árbol, usar el índice
    // nuevo por diferencia de hijos WANConnectionDevice.
    const wcdBase = `${WAN_DEV}.1.WANConnectionDevice`;
    const cds = genieChildIndices(current, wcdBase);
    const known = new Set(conns.map((c) => c.cd));
    const newCd = cds.find((cd) => !known.has(cd));
    if (newCd != null) return `${wcdBase}.${newCd}`;
    return pickWanConnectionDevice(after.length ? after : conns);
  })();

  notes.push(`2/3 AddObject ${connDevice}.WANIPConnection`);
  try {
    const add = await client.addObject(
      deviceId,
      `${connDevice}.WANIPConnection`,
      addOpts,
    );
    notes.push(
      add.status === 200
        ? 'WANIPConnection creada'
        : `WANIPConnection encolada (status ${add.status})`,
    );
  } catch (e) {
    return {
      ok: false,
      notes: [
        ...notes,
        `AddObject WANIPConnection falló: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ],
    };
  }
  if (!enqueueOnly) {
    await refreshWanTree(client, deviceId);
    current = (await client.findBySerial(ctx.sn)) ?? current;
  }
  return { ok: true, device: current, notes };
}

export async function ensureHuaweiServiceWan(
  ctx: OnuModelProvisionCtx,
): Promise<OnuModelProvisionResult> {
  const notes: string[] = [];
  const { client, deviceId, wan } = ctx;
  const enqueueOnly = !!ctx.enqueueOnly;
  let device = ctx.device;

  if (isServiceWanApplied(device, wan)) {
    return {
      ok: true,
      notes: [
        `WAN INTERNET ya en vlan=${wan.wanVlan} ip=${wan.wanIp}`,
      ],
    };
  }

  if (!enqueueOnly) {
    await refreshWanTree(client, deviceId);
    const fresh = await client.findBySerial(ctx.sn);
    if (fresh) device = fresh;
  }

  let conns = listHuaweiWanIpConnections(device);
  let target = findHuaweiInternetWan(conns);
  const before = conns;

  if (!target) {
    const blank = findReusableBlankHuaweiWan(conns);
    if (blank) {
      target = blank;
      notes.push(
        `reutiliza WAN vacía (${blank.conn.split('.').slice(-3).join('.')})`,
      );
    }
  }

  if (!target) {
    const created = await createServiceWanConnection(ctx, device, conns, notes);
    if (!created.ok) return { ok: false, notes: created.notes };
    device = created.device;
    conns = listHuaweiWanIpConnections(device);
    target = resolveNewWanConnection(before, conns);
    if (!target && enqueueOnly) {
      // Árbol aún sin el índice: predecir WCD siguiente y SPV en cola.
      // HG8145X6 suele auto-crear WANIPConnection.1 al AddObject del WCD.
      const wcdBase = `${WAN_DEV}.1.WANConnectionDevice`;
      const cds = genieChildIndices(device, wcdBase);
      const nextCd = Math.max(0, ...cds, ...before.map((c) => c.cd)) + 1;
      target = {
        cd: nextCd,
        ip: 1,
        conn: `${wcdBase}.${nextCd}.WANIPConnection.1`,
        connDevice: `${wcdBase}.${nextCd}`,
        name: null,
        serviceList: null,
        vlan: null,
        externalIp: null,
        status: null,
        dnsServers: null,
      };
      notes.push(
        `SPV predicho a WCD.${nextCd} (encolado; Inform post-reboot aplica)`,
      );
    }
    if (!target) {
      return {
        ok: false,
        notes: [
          ...notes,
          'el CPE no creó la WAN de servicio (AddObject rechazado o aún sin Inform)',
        ],
      };
    }
  } else if (!notes.some((n) => n.startsWith('reutiliza'))) {
    notes.push(
      `WAN INTERNET existente (${target.conn.split('.').slice(-3).join('.')})`,
    );
  }

  const params = buildHuaweiServiceWanParams(target.conn, wan);
  const dns = expectedHuaweiDns(wan);
  try {
    const spv = await client.setParameterValues(deviceId, params, {
      wait: !enqueueOnly,
    });
    notes.push(
      spv.status === 200
        ? `3/3 SPV INTERNET ${wan.wanIp} vlan=${wan.wanVlan} (NAT+DNS+LANBIND)`
        : `3/3 SPV INTERNET ${wan.wanIp} vlan=${wan.wanVlan} encolada (status ${spv.status})`,
    );
  } catch (e) {
    return {
      ok: false,
      notes: [
        ...notes,
        `SPV falló: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }

  // HG8245W5: el lote puede responder 200 y dejar DNSServers en blanco.
  // Misma cura que el path genérico (ensureWanLeaf): SPV solo de DNS.
  if (dns) {
    try {
      const dnsSpv = await client.setParameterValues(
        deviceId,
        [
          [`${target.conn}.DNSServers`, dns, 'xsd:string'],
          [`${target.conn}.DNSEnabled`, true, 'xsd:boolean'],
        ],
        { wait: !enqueueOnly },
      );
      notes.push(
        dnsSpv.status === 200
          ? `DNS ${dns} (hoja sola)`
          : `DNS ${dns} encolado (status ${dnsSpv.status})`,
      );
    } catch (e) {
      notes.push(
        `DNS hoja sola falló: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { ok: true, notes };
}

/**
 * Aprovisionamiento completo del modelo. Toma prioridad sobre el picker
 * genérico (que en la plantilla ISP multi-WAN agarra la WAN OTHER):
 *
 *  1. Si el servicio ya está bien puesto, no toca nada (evita reinicios del
 *     poller sobre una ONU sana).
 *  2. Si el CPE no es manejable (sólo informa en el bootstrap), rompe el
 *     deadlock: pre-carga credenciales de conexión + Inform corto y reinicia la
 *     ONU (con tope anti-bucle). La plantilla queda encolada SIN
 *     connection-request y entra en el próximo Inform.
 *  3. Aplica la plantilla eligiendo la WAN INTERNET (VLAN + IP fija + NAT +
 *     LANBIND).
 */
export async function provisionHuaweiHgu(
  ctx: OnuModelProvisionCtx,
): Promise<OnuModelProvisionResult> {
  const notes: string[] = [];

  if (isServiceWanApplied(ctx.device, ctx.wan)) {
    return {
      ok: true,
      notes: [`WAN INTERNET ya en vlan=${ctx.wan.wanVlan} ip=${ctx.wan.wanIp}`],
    };
  }

  const reachable = await ctx.isReachable();
  if (!reachable) {
    // La ONU sólo informó en el bootstrap: sin sesión, GenieACS no puede
    // aplicar nada. Se pre-cargan credenciales + Inform y se reinicia para
    // forzar un bootstrap que ejecute la cola.
    notes.push(await ctx.preloadConnReq());
    const rb = await ctx.reboot({ force: ctx.explicit });
    notes.push(rb.note);
    const tmpl = await ensureHuaweiServiceWan({ ...ctx, enqueueOnly: true });
    return { ok: tmpl.ok, notes: [...notes, ...tmpl.notes] };
  }

  const tmpl = await ensureHuaweiServiceWan(ctx);
  return { ok: tmpl.ok, notes: [...notes, ...tmpl.notes] };
}



export async function provisionHuaweiHguModel(
  ctx: OnuModelProvisionCtx,
): Promise<OnuModelProvisionResult> {
  return provisionHuaweiHgu(ctx);
}

export async function ensureHuaweiHguServiceWan(
  ctx: OnuModelProvisionCtx,
): Promise<OnuModelProvisionResult> {
  return ensureHuaweiServiceWan(ctx);
}
