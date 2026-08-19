import {
  portMoveError,
  resolveSwitchBridge,
  type LiveBridgePort,
} from './switch-bridge.util';

/** Real layout of the concentrator switch: bridge is called `wan`, not `bridge`. */
const LIVE: LiveBridgePort[] = [
  { interface: 'sfp-sfpplus1', bridge: 'wan' },
  { interface: 'sfp-sfpplus2', bridge: 'wan' },
  { interface: 'sfp-sfpplus3', bridge: 'wan' },
  { interface: 'sfp-sfpplus4', bridge: 'wan' },
];

describe('resolveSwitchBridge', () => {
  it('reuses the bridge the selected ports already belong to', () => {
    const r = resolveSwitchBridge({
      selectedPortNames: ['sfp-sfpplus1', 'sfp-sfpplus4'],
      livePorts: LIVE,
      liveBridgeNames: ['wan'],
    });
    expect(r).toEqual({ ok: true, bridge: 'wan', create: false });
  });

  it('refuses a bridge name the switch does not have', () => {
    const r = resolveSwitchBridge({
      requested: 'bridge',
      selectedPortNames: ['sfp-sfpplus1', 'sfp-sfpplus4'],
      livePorts: LIVE,
      liveBridgeNames: ['wan'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('wan');
  });

  it('creates a new bridge only when explicitly asked', () => {
    const r = resolveSwitchBridge({
      requested: 'lab',
      createBridge: true,
      selectedPortNames: ['ether1'],
      livePorts: LIVE,
      liveBridgeNames: ['wan'],
    });
    expect(r).toEqual({ ok: true, bridge: 'lab', create: true });
  });

  it('matches an existing bridge case-insensitively without creating it', () => {
    const r = resolveSwitchBridge({
      requested: 'WAN',
      createBridge: true,
      selectedPortNames: ['sfp-sfpplus1'],
      livePorts: LIVE,
      liveBridgeNames: ['wan'],
    });
    expect(r).toEqual({ ok: true, bridge: 'wan', create: false });
  });

  it('rejects a selection that spans several bridges', () => {
    const r = resolveSwitchBridge({
      selectedPortNames: ['sfp-sfpplus1', 'ether5'],
      livePorts: [...LIVE, { interface: 'ether5', bridge: 'lab' }],
      liveBridgeNames: ['wan', 'lab'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('bridges distintos');
  });

  it('falls back to the only bridge when the ports are not enslaved yet', () => {
    const r = resolveSwitchBridge({
      selectedPortNames: ['ether7'],
      livePorts: LIVE,
      liveBridgeNames: ['wan'],
    });
    expect(r).toEqual({ ok: true, bridge: 'wan', create: false });
  });

  it('asks which bridge when there are several and no hint', () => {
    const r = resolveSwitchBridge({
      selectedPortNames: ['ether7'],
      livePorts: LIVE,
      liveBridgeNames: ['wan', 'lab'],
    });
    expect(r.ok).toBe(false);
  });

  it('creates the default bridge on a switch with none', () => {
    const r = resolveSwitchBridge({
      selectedPortNames: ['ether1'],
      livePorts: [],
      liveBridgeNames: [],
    });
    expect(r).toEqual({ ok: true, bridge: 'bridge', create: true });
  });
});

describe('portMoveError', () => {
  it('blocks pulling a port out of its current bridge', () => {
    expect(
      portMoveError({
        portName: 'sfp-sfpplus4',
        currentBridge: 'wan',
        targetBridge: 'bridge',
      }),
    ).toContain('sfp-sfpplus4');
  });

  it('allows a port already on the target bridge', () => {
    expect(
      portMoveError({
        portName: 'sfp-sfpplus4',
        currentBridge: 'wan',
        targetBridge: 'WAN',
      }),
    ).toBeNull();
  });

  it('allows a port not attached to any bridge', () => {
    expect(
      portMoveError({ portName: 'ether7', targetBridge: 'wan' }),
    ).toBeNull();
  });
});
