/**
 * ZTE ONU admin suspend/resume (not delete).
 *
 * C300/C320: `onu N disable` on the OLT port is not a keyword
 *   → Error 20201 Invalid command key word.
 *   Suspend = `interface gpon-onu_…` + `shutdown` (SN stays authorized).
 *
 * C6xx Titan: native `onu N disable` / `onu N enable` on the OLT port.
 *   Fallback to ONU-interface shutdown if the keyword is missing.
 */
import type { ZteFwFamily } from './ifname';

export type ZteOnuAdminAction = 'disable' | 'enable';

export type ZteOnuAdminAttempt = {
  id: 'olt-onu-flag' | 'onu-if-shutdown';
  enterIf: string;
  cmd: string;
};

const CLI_REJECT =
  /%Error|Invalid command|Invalid input|Incomplete command|Unknown command|Failed/i;

export function zteCliLooksRejected(out: string): boolean {
  return CLI_REJECT.test(out);
}

export function zteOnuAdminAttempts(opts: {
  action: ZteOnuAdminAction;
  fwFamily: ZteFwFamily;
  oltIf: string;
  onuIf: string;
  onuId: string;
}): ZteOnuAdminAttempt[] {
  const oltFlag: ZteOnuAdminAttempt = {
    id: 'olt-onu-flag',
    enterIf: opts.oltIf,
    cmd:
      opts.action === 'disable'
        ? `onu ${opts.onuId} disable`
        : `onu ${opts.onuId} enable`,
  };
  const ifShutdown: ZteOnuAdminAttempt = {
    id: 'onu-if-shutdown',
    enterIf: opts.onuIf,
    cmd: opts.action === 'disable' ? 'shutdown' : 'no shutdown',
  };
  // C6xx has `onu N disable`. C3xx (and unknown, mostly C320 in this fleet)
  // must shutdown the ONU interface first.
  if (opts.fwFamily === 'c6xx') return [oltFlag, ifShutdown];
  return [ifShutdown, oltFlag];
}

export async function applyZteOnuAdminToggle(opts: {
  action: ZteOnuAdminAction;
  fwFamily: ZteFwFamily;
  oltIf: string;
  onuIf: string;
  onuId: string;
  send: (cmd: string) => Promise<void>;
  read: (ms: number) => Promise<string>;
  clean: (raw: string) => string;
}): Promise<{ method: ZteOnuAdminAttempt['id']; output: string }> {
  const attempts = zteOnuAdminAttempts(opts);
  let lastFail = '';

  for (const attempt of attempts) {
    await opts.send(`interface ${attempt.enterIf}`);
    const ifOut = opts.clean(await opts.read(10_000));
    if (zteCliLooksRejected(ifOut)) {
      lastFail = `interface ${attempt.enterIf}: ${ifOut.replace(/\s+/g, ' ').trim()}`;
      continue;
    }

    await opts.send(attempt.cmd);
    const cmdOut = opts.clean(await opts.read(12_000));
    await opts.send('exit');
    await opts.read(8_000);

    const already =
      /already|is\s+shutdown|isn't\s+shutdown|not\s+shutdown/i.test(cmdOut);
    if (zteCliLooksRejected(cmdOut) && !already) {
      lastFail = `${attempt.cmd}: ${cmdOut.replace(/\s+/g, ' ').trim()}`;
      continue;
    }

    return { method: attempt.id, output: cmdOut };
  }

  const verb = opts.action === 'disable' ? 'deshabilitar' : 'rehabilitar';
  throw new Error(
    `Fallo al ${verb} (no se borró la ONU): ${(lastFail || 'sin respuesta de la OLT')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240)}`,
  );
}
