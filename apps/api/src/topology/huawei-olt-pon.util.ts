import { buildHuaweiOltIf, isHuaweiGponCard } from './huawei-olt-onu.util';

export type HuaweiPonPortRaw = {
  rack: string;
  shelf: string;
  slot: string;
  port: string;
  ifName: string;
  boardType: string;
  ponType: 'gpon';
  adminEnabled: boolean;
  status: 'Up' | 'Down';
  onuOnline: number;
  onuTotal: number;
  maxOnus: number;
  avgSignalDbm: number | null;
  description: string | null;
  minRangeM: number;
  maxRangeM: number;
  rogueDetectEnabled: boolean | null;
  txPowerDbm: number | null;
};

export function buildHuaweiPonIfName(
  slot: string | number,
  port: string | number,
): string {
  return buildHuaweiOltIf(slot, port);
}

export function buildHuaweiPonPorts(
  cards: Array<{
    slot: string;
    cfgType: string;
    realType: string;
    ports?: number;
  }>,
): HuaweiPonPortRaw[] {
  const rows: HuaweiPonPortRaw[] = [];
  for (const card of cards) {
    const type = card.realType || card.cfgType;
    if (!isHuaweiGponCard(type)) continue;
    const ports = card.ports ?? 16;
    for (let port = 0; port < ports; port++) {
      rows.push({
        rack: '0',
        shelf: '0',
        slot: card.slot,
        port: String(port),
        ifName: buildHuaweiOltIf(card.slot, port),
        boardType: type,
        ponType: 'gpon',
        // Board inventory cannot prove per-port admin/oper state. Keep the
        // conservative state until CLI/SNMP supplies an observed status.
        adminEnabled: false,
        status: 'Down',
        onuOnline: 0,
        onuTotal: 0,
        maxOnus: 128,
        avgSignalDbm: null,
        description: null,
        minRangeM: 0,
        maxRangeM: 20000,
        rogueDetectEnabled: null,
        txPowerDbm: null,
      });
    }
  }
  return rows;
}
