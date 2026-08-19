/**
 * Bridge resolution for VLAN pushes to MikroTik RouterOS switches.
 *
 * Adding a VLAN must never relocate a port: creating a bridge and moving ports
 * into it puts them in a separate L2 domain, which silently isolates whatever
 * was reachable through them. So an unknown bridge is refused unless the caller
 * explicitly asked to create one, and a port that already belongs elsewhere is
 * never moved.
 */

export type LiveBridgePort = { interface: string; bridge: string };

export type ResolveBridgeInput = {
  requested?: string;
  createBridge?: boolean;
  selectedPortNames: string[];
  livePorts: LiveBridgePort[];
  liveBridgeNames: string[];
};

export type ResolveBridgeResult =
  | { ok: true; bridge: string; create: boolean }
  | { ok: false; error: string };

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function resolveSwitchBridge(
  input: ResolveBridgeInput,
): ResolveBridgeResult {
  const { selectedPortNames, livePorts } = input;
  const names = input.liveBridgeNames.filter(Boolean);
  const requested = input.requested?.trim();
  const listing = names.length ? names.join(', ') : 'ninguno';

  if (requested) {
    const found = names.find((n) => eq(n, requested));
    if (found) return { ok: true, bridge: found, create: false };
    if (names.length && !input.createBridge) {
      return {
        ok: false,
        error:
          `El switch no tiene un bridge «${requested}». Bridges existentes: ${listing}. ` +
          'Marca la opción de crear bridge nuevo si es lo que quieres.',
      };
    }
    return { ok: true, bridge: requested, create: true };
  }

  const bridgesOfSelected = [
    ...new Set(
      selectedPortNames
        .map(
          (name) =>
            livePorts.find((bp) => eq(bp.interface, name))?.bridge || '',
        )
        .filter(Boolean),
    ),
  ];

  if (bridgesOfSelected.length === 1) {
    return { ok: true, bridge: bridgesOfSelected[0], create: false };
  }
  if (bridgesOfSelected.length > 1) {
    return {
      ok: false,
      error:
        `Los puertos seleccionados están en bridges distintos (${bridgesOfSelected.join(', ')}). ` +
        'Elige el bridge explícitamente o selecciona puertos de un solo bridge.',
    };
  }

  if (names.length === 1) return { ok: true, bridge: names[0], create: false };
  if (names.length > 1) {
    return {
      ok: false,
      error:
        `El switch tiene varios bridges (${listing}) y los puertos elegidos no están en ninguno. ` +
        'Indica en cuál crear la VLAN.',
    };
  }
  return { ok: true, bridge: 'bridge', create: true };
}

/**
 * A port already enslaved to a different bridge must not be pulled over.
 * Returns an error message when the move would happen, `null` when it is safe.
 */
export function portMoveError(params: {
  portName: string;
  currentBridge?: string;
  targetBridge: string;
}): string | null {
  const { portName, currentBridge, targetBridge } = params;
  if (!currentBridge || eq(currentBridge, targetBridge)) return null;
  return (
    `«${portName}» ya pertenece al bridge «${currentBridge}». Moverlo a «${targetBridge}» ` +
    'cortaría el tráfico que pasa por ese puerto: sácalo a mano si es lo que quieres.'
  );
}
