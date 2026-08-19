import {
  isManagementConnection,
  pickServiceWanConnection,
  type WanConnectionCandidate,
} from './wan-connection';

const cand = (
  n: number,
  externalIp: string | null,
  name: string | null,
): WanConnectionCandidate => ({
  connDevice: `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${n}`,
  conn: `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${n}.WANIPConnection.1`,
  externalIp,
  name,
});

describe('reconocer la conexión de gestión', () => {
  it('la delata la IP de mgmt', () => {
    expect(
      isManagementConnection(
        { externalIp: '30.30.20.5', name: 'lo que sea' },
        '30.30.20.5',
      ),
    ).toBe(true);
  });

  it('la delata el nombre cuando el árbol aún no publica la IP', () => {
    expect(
      isManagementConnection(
        { externalIp: null, name: '2_TR069_R_VID_401' },
        '30.30.20.5',
      ),
    ).toBe(true);
  });

  it('no confunde la de servicio', () => {
    expect(
      isManagementConnection(
        { externalIp: '40.40.20.5', name: '1_INTERNET_R_VID_701' },
        '30.30.20.5',
      ),
    ).toBe(false);
  });

  it('sin IP de mgmt conocida sigue usando el nombre', () => {
    expect(
      isManagementConnection({ externalIp: '10.0.0.1', name: 'TR-069' }, null),
    ).toBe(true);
  });

  it('la lista de servicios manda sobre el nombre genérico de TR-181', () => {
    expect(
      isManagementConnection(
        {
          externalIp: '30.30.20.62',
          name: 'DEV.IP.IF4',
          serviceList: 'TR069_VoIP',
        },
        null,
      ),
    ).toBe(true);
  });

  it('una WAN de servicio que además anuncia TR069 no es de gestión', () => {
    expect(
      isManagementConnection(
        {
          externalIp: '40.40.21.10',
          name: 'DEV.IP.IF5',
          serviceList: 'INTERNET_TR069_VoIP',
        },
        '30.30.20.62',
      ),
    ).toBe(false);
  });
});

describe('elegir la conexión de servicio', () => {
  it('escoge la de servicio aunque venga después de la de gestión', () => {
    const out = pickServiceWanConnection(
      [
        cand(1, '30.30.20.5', '1_TR069_R_VID_401'),
        cand(2, '40.40.20.5', '2_INTERNET_R_VID_701'),
      ],
      '30.30.20.5',
    );
    expect(out?.isMgmt).toBe(false);
    expect(out?.chosen.connDevice).toContain('WANConnectionDevice.2');
  });

  it('avisa cuando la única que hay es la de gestión, en vez de escribirla', () => {
    const out = pickServiceWanConnection(
      [cand(1, '30.30.20.9', '1_TR069_R_VID_401')],
      '30.30.20.9',
    );
    expect(out?.isMgmt).toBe(true);
  });

  it('no elige la de gestión por tener la IP vacía', () => {
    const out = pickServiceWanConnection(
      [
        cand(1, null, '1_TR069_R_VID_401'),
        cand(2, null, '2_INTERNET_R_VID_80'),
      ],
      '30.30.20.5',
    );
    expect(out?.chosen.connDevice).toContain('WANConnectionDevice.2');
  });

  it('sin candidatas no inventa una ruta', () => {
    expect(pickServiceWanConnection([], '30.30.20.5')).toBeNull();
  });

  it('prefiere la que ya lleva la IP esperada, no la heredada', () => {
    const out = pickServiceWanConnection(
      [
        cand(1, '10.0.110.3', '1_INTERNET_R_VID_351'),
        cand(2, '40.40.21.10', '2_INTERNET_R_VID_702'),
      ],
      '30.30.20.5',
      { ip: '40.40.21.10' },
    );
    expect(out?.chosen.externalIp).toBe('40.40.21.10');
  });

  it('cuando la IP aún no está puesta se guía por la VLAN esperada', () => {
    const legacy = { ...cand(1, '10.0.110.3', 'vieja'), vlanId: 351 };
    const nueva = { ...cand(2, null, 'nueva'), vlanId: 702 };
    const out = pickServiceWanConnection([legacy, nueva], '30.30.20.5', {
      vlanId: 702,
    });
    expect(out?.chosen.connDevice).toContain('WANConnectionDevice.2');
  });

  it('con una sola de servicio la usa', () => {
    const out = pickServiceWanConnection(
      [cand(1, '10.190.0.14', '1_INTERNET_R_VID_80')],
      '30.30.20.5',
    );
    expect(out?.isMgmt).toBe(false);
    expect(out?.chosen.externalIp).toBe('10.190.0.14');
  });
});
