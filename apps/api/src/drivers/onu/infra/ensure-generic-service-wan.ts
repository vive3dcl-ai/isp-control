/**
 * Un tick del playbook genérico: lee el árbol, un mutación (junk / AddObject / SPV).
 */
import type { OnuModelProvisionCtx, OnuModelProvisionResult } from '../types';
import { ACS_HGU_PARAM_OWNERS, OMCI_BRIDGE_PARAM_OWNERS } from '../param-owners';
import { applyGenericServiceSpv } from './service-spv';
import { findServiceWanConnection } from './wan-datamodel';
import {
  inspectGenericPlaybook,
  type GenericPlaybookFamily,
} from './inspect-generic-playbook';
import {
  assessServiceRoute,
} from '../models/generic-zte/route';
import { assessServiceLanBind } from './lan-bind';
import { healServiceL2IfNeeded } from './service-carrier';
import { healServiceWanVlanToPanel } from './service-wan-vlan';

function ownersFor(family: GenericPlaybookFamily) {
  if (family === 'zte_bridge' || family === 'unknown_bridge') {
    return OMCI_BRIDGE_PARAM_OWNERS;
  }
  return ACS_HGU_PARAM_OWNERS;
}

function is9007(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /9007|9003/.test(msg);
}

export async function ensureGenericServiceWan(
  ctx: OnuModelProvisionCtx,
  familyHint?: GenericPlaybookFamily,
): Promise<OnuModelProvisionResult> {
  const plan = inspectGenericPlaybook({
    sn: ctx.sn,
    onuType: ctx.onuType,
    acsModel: ctx.acsModel,
    device: ctx.device,
    expectedVlan: ctx.wan.wanVlan,
    expectedIp: ctx.wan.wanIp,
  });
  const family = familyHint ?? plan.family;
  const notes = [...plan.notes];

  if (plan.steps.includes('omci')) {
    return {
      ok: true,
      notes: [...notes, 'WAN de servicio: OMCI (puente)'],
    };
  }

  // VLAN panel primero: change o delete+recreate (nunca adoptar VLAN fantasma).
  const vlanHeal = await healServiceWanVlanToPanel(ctx, { family });
  if (vlanHeal) {
    return {
      ok: vlanHeal.ok,
      notes: [...notes, ...vlanHeal.notes],
      progress: vlanHeal.progress,
    };
  }

  // ACS puede tener IP/VLAN bien y aun así ERROR_NO_CARRIER sin service-port.
  const l2 = await healServiceL2IfNeeded(ctx);
  if (l2) {
    return {
      ok: l2.ok,
      notes: [...notes, ...l2.notes],
      progress: l2.progress,
    };
  }

  if (!plan.steps.length) {
    return { ok: false, notes };
  }

  try {
    if (plan.steps[0] === 'junk' && plan.junkWanPath) {
      await ctx.client.setParameterValues(ctx.deviceId, [
        [`${plan.junkWanPath}.Enable`, false, 'xsd:boolean'],
      ]);
      return {
        ok: false,
        notes: [...notes, `WAN fábrica ${plan.junkWanPath} deshabilitada`],
      };
    }

    if (plan.steps.includes('add') && plan.addObjectParent) {
      const add = await ctx.client.addObject(
        ctx.deviceId,
        plan.addObjectParent,
      );
      notes.push(
        add.status === 200 || add.status === 202
          ? `AddObject ${plan.addObjectParent} status ${add.status}`
          : `AddObject status ${add.status}`,
      );
      return { ok: false, notes };
    }

    const found =
      findServiceWanConnection(ctx.device, {
        expectedIp: ctx.wan.wanIp,
        expectedVlanId: ctx.wan.wanVlan,
      }) ??
      (plan.wanPath
        ? {
            conn: plan.wanPath,
            connDevice: plan.wanDevicePath ?? plan.wanPath,
            isMgmt: false,
            model: plan.dataModel === 'tr181' ? 'tr181' : 'tr098',
          }
        : null);

    if (!found || found.isMgmt) {
      return {
        ok: false,
        notes: [...notes, 'sin WAN de servicio tras inspeccionar árbol'],
      };
    }

    const msg = await applyGenericServiceSpv({
      client: ctx.client,
      deviceId: ctx.deviceId,
      device: ctx.device,
      sn: ctx.sn,
      wan: ctx.wan,
      found,
      owners: ownersFor(family),
    });
    notes.push(msg);

    const bind = assessServiceLanBind(ctx.device, found.conn);
    if (!bind.ok && bind.heal?.length) {
      try {
        await ctx.client.setParameterValues(ctx.deviceId, bind.heal);
        notes.push(`bind ${bind.message}`);
      } catch (e) {
        notes.push(
          `bind omitido: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (plan.steps.includes('route')) {
      const route = assessServiceRoute(ctx.device, {
        serviceConn: found.conn,
        expectedGateway: ctx.wan.wanGateway,
        dataModel: plan.dataModel,
      });
      if (!route.ok && route.routeFix?.length) {
        await ctx.client.setParameterValues(ctx.deviceId, route.routeFix);
        notes.push(route.message);
      } else if (!route.ok) {
        notes.push(route.message);
      }
    }

    return { ok: true, notes };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      notes: [
        ...notes,
        is9007(err) ? `fault ACS (no reintentar hoja): ${msg}` : msg,
      ],
    };
  }
}
