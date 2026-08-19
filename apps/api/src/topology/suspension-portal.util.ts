export function isOnuAdminDisabled(adminState: string | null | undefined): boolean {
  return /disable/i.test(adminState ?? '');
}

export type PortalSuspendPlan =
  | { action: 'portal'; wanIp: string }
  | { action: 'olt_fallback'; reason: string };

export function planPortalSuspend(opts: {
  wanIp?: string | null;
  oltId?: string | null;
  onuIf?: string | null;
}): PortalSuspendPlan {
  const wanIp = opts.wanIp?.trim() ?? '';
  if (!wanIp) {
    return {
      action: 'olt_fallback',
      reason: 'La ONU no tiene IP WAN; se aplica disable en la OLT (sin portal cautivo).',
    };
  }
  if (!opts.oltId || !opts.onuIf) {
    return {
      action: 'olt_fallback',
      reason: 'La ONU no tiene interfaz OLT; no se puede aplicar el portal.',
    };
  }
  return { action: 'portal', wanIp };
}

export function shouldRefreshSuspendedAddressList(opts: {
  portalEnabled: boolean;
  serviceStatus?: string | null;
  wanIp?: string | null;
}): boolean {
  return (
    opts.portalEnabled &&
    opts.serviceStatus === 'suspended' &&
    !!opts.wanIp?.trim()
  );
}
