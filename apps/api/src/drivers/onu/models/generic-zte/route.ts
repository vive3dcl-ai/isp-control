/**
 * Ruta por defecto y WAN legacy (SmartOLT) en CPE TR-181.
 *
 * Tras migrar, las ZTE F6600P suelen conservar `Device.IP.Interface.{i}` en
 * 10.0.110.x (INTERNET) con `0.0.0.0/0` apuntando a 10.0.110.1. El verify
 * clásico solo mira la WAN de servicio (40.40.x): Connected + DNS + ARP → ok,
 * pero el cliente no navega. Estas helpers detectan el desvío y dan los paths
 * para curar (disable legacy + re-apuntar IPv4Forwarding).
 */
import {
  boolVal,
  genieChildIndices,
  genieGet,
  strVal,
} from '../../../../topology/shared/genieacs-nbi.client';

export type Tr181DefaultRoute = {
  path: string;
  gateway: string | null;
  iface: string | null;
  enable: boolean | null;
};

export type Tr181IpIface = {
  path: string;
  ip: string | null;
  gateway: string | null;
  serviceList: string | null;
  enable: boolean | null;
  status: string | null;
};

export type ServiceRouteAssessment = {
  /** false = el CPE no sale por la WAN de servicio del pool. */
  ok: boolean;
  message: string;
  model: 'tr181' | 'tr098' | 'unknown';
  defaultRoute: Tr181DefaultRoute | null;
  legacyIfaces: Tr181IpIface[];
  /** Paths a desactivar (Enable=false). */
  disablePaths: string[];
  /** SPV para alinear la ruta 0.0.0.0 con la WAN de servicio. */
  routeFix: Array<[string, string | boolean, string]> | null;
};

const LEGACY_NET_RE = /^10\.0\.110\./;

function listTr181IpIfaces(
  device: Record<string, unknown>,
): Tr181IpIface[] {
  const out: Tr181IpIface[] = [];
  for (const i of genieChildIndices(device, 'Device.IP.Interface')) {
    const path = `Device.IP.Interface.${i}`;
    const addrIdx = genieChildIndices(device, `${path}.IPv4Address`)[0];
    if (addrIdx == null) continue;
    const addr = `${path}.IPv4Address.${addrIdx}`;
    const ip = strVal(genieGet(device, `${addr}.IPAddress`));
    if (!ip) continue;
    out.push({
      path,
      ip,
      gateway:
        strVal(genieGet(device, `${addr}.X_ZTE-COM_Gateway`)) ??
        strVal(genieGet(device, `${addr}.Gateway`)),
      serviceList: strVal(
        genieGet(device, `${path}.X_ZTE-COM_ServiceList`),
      ),
      enable: boolVal(genieGet(device, `${path}.Enable`)),
      status: strVal(genieGet(device, `${path}.Status`)),
    });
  }
  return out;
}

export function listTr181DefaultRoutes(
  device: Record<string, unknown>,
): Tr181DefaultRoute[] {
  const out: Tr181DefaultRoute[] = [];
  for (const r of genieChildIndices(device, 'Device.Routing.Router')) {
    const base = `Device.Routing.Router.${r}.IPv4Forwarding`;
    for (const f of genieChildIndices(device, base)) {
      const path = `${base}.${f}`;
      const dest = strVal(genieGet(device, `${path}.DestIPAddress`));
      if (dest !== '0.0.0.0') continue;
      out.push({
        path,
        gateway: strVal(genieGet(device, `${path}.GatewayIPAddress`)),
        iface: strVal(genieGet(device, `${path}.Interface`)),
        enable: boolVal(genieGet(device, `${path}.Enable`)),
      });
    }
  }
  return out;
}

/** WAN SmartOLT típica: 10.0.110.* marcada INTERNET (sin TR069). */
export function findLegacySmartOltInternetIfaces(
  device: Record<string, unknown>,
  serviceConn?: string | null,
): Tr181IpIface[] {
  return listTr181IpIfaces(device).filter((iface) => {
    if (serviceConn && iface.path === serviceConn) return false;
    if (!iface.ip || !LEGACY_NET_RE.test(iface.ip)) return false;
    const serv = iface.serviceList ?? '';
    if (!/INTERNET/i.test(serv)) return false;
    if (/TR069/i.test(serv)) return false;
    return iface.enable !== false;
  });
}

/**
 * ¿La salida por defecto del CPE coincide con la WAN de servicio del pool?
 * TR-098: la ruta va en DefaultGateway de la WANIPConnection (ya lo mira
 * `wan`); aquí devolvemos ok sin inspección extra.
 */
export function assessServiceRoute(
  device: Record<string, unknown>,
  opts: {
    serviceConn: string;
    expectedGateway: string;
    dataModel: 'tr098' | 'tr181';
  },
): ServiceRouteAssessment {
  if (opts.dataModel !== 'tr181') {
    return {
      ok: true,
      message: 'TR-098 (gateway en la WAN)',
      model: 'tr098',
      defaultRoute: null,
      legacyIfaces: [],
      disablePaths: [],
      routeFix: null,
    };
  }

  const legacyIfaces = findLegacySmartOltInternetIfaces(
    device,
    opts.serviceConn,
  );
  const defaults = listTr181DefaultRoutes(device).filter(
    (r) => r.enable !== false,
  );
  const defaultRoute = defaults[0] ?? null;
  const problems: string[] = [];

  if (legacyIfaces.length) {
    problems.push(
      `WAN legacy activa ${legacyIfaces.map((i) => i.ip).join(',')}`,
    );
  }

  if (!defaultRoute) {
    problems.push('sin ruta por defecto 0.0.0.0');
  } else {
    if (
      defaultRoute.iface &&
      defaultRoute.iface !== opts.serviceConn &&
      !defaultRoute.iface.startsWith(`${opts.serviceConn}.`)
    ) {
      problems.push(
        `defroute iface=${defaultRoute.iface} (esperada ${opts.serviceConn})`,
      );
    }
    if (
      opts.expectedGateway &&
      defaultRoute.gateway &&
      defaultRoute.gateway !== opts.expectedGateway
    ) {
      problems.push(
        `defroute gw=${defaultRoute.gateway} (esperado ${opts.expectedGateway})`,
      );
    }
  }

  const routeFix: Array<[string, string | boolean, string]> | null =
    defaultRoute && opts.expectedGateway
      ? [
          [defaultRoute.path + '.Interface', opts.serviceConn, 'xsd:string'],
          [
            defaultRoute.path + '.GatewayIPAddress',
            opts.expectedGateway,
            'xsd:string',
          ],
          [defaultRoute.path + '.Enable', true, 'xsd:boolean'],
        ]
      : null;

  return {
    ok: problems.length === 0,
    message: problems.length ? problems.join('; ') : 'ruta → WAN servicio',
    model: 'tr181',
    defaultRoute,
    legacyIfaces,
    disablePaths: legacyIfaces.map((i) => i.path),
    routeFix,
  };
}
