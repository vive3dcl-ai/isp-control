import {
  CONN_REQ_INFORM_INTERVAL_S,
  CONN_REQ_USERNAME,
  buildConnReqParameterValues,
  connReqCredentials,
  connReqPassword,
  detectDataModelRoot,
  shouldShortenInformInterval,
  shouldWriteConnReqCredentials,
  connreqCredentialsTrusted,
} from './connreq-credentials';

describe('credenciales de petición de conexión', () => {
  it('da la misma clave para el mismo SN, para poder recalcularla', () => {
    expect(connReqPassword('FHTT968157D8')).toBe(
      connReqPassword('FHTT968157D8'),
    );
  });

  it('da claves distintas a equipos distintos', () => {
    expect(connReqPassword('FHTT968157D8')).not.toBe(
      connReqPassword('FHTT964E69A8'),
    );
  });

  it('ignora espacios y mayúsculas del SN', () => {
    expect(connReqPassword(' fhtt968157d8 ')).toBe(
      connReqPassword('FHTT968157D8'),
    );
  });

  it('cabe en 16 caracteres y empieza por letra', () => {
    const p = connReqPassword('HWTC9D03F4A4');
    expect(p).toHaveLength(16);
    expect(p).toMatch(/^[A-Za-z][0-9a-f]{15}$/);
  });

  it('no filtra el número de serie en la clave', () => {
    expect(connReqPassword('FHTT968157D8')).not.toContain('968157D8');
  });

  it('usa un usuario fijo', () => {
    expect(connReqCredentials('FHTT968157D8').username).toBe(CONN_REQ_USERNAME);
  });
});

describe('raíz del modelo de datos', () => {
  it('reconoce los TR-098', () => {
    expect(detectDataModelRoot({ InternetGatewayDevice: {} })).toBe(
      'InternetGatewayDevice',
    );
  });

  it('reconoce los TR-181', () => {
    expect(detectDataModelRoot({ Device: {} })).toBe('Device');
  });

  it('no se deja engañar por un InternetGatewayDevice vacío de las ZTE', () => {
    expect(
      detectDataModelRoot({
        InternetGatewayDevice: {},
        Device: { ManagementServer: { ConnectionRequestUsername: {} } },
      }),
    ).toBe('Device');
  });

  it('con los dos árboles poblados manda el TR-098', () => {
    expect(
      detectDataModelRoot({
        InternetGatewayDevice: { ManagementServer: {} },
        Device: { ManagementServer: {} },
      }),
    ).toBe('InternetGatewayDevice');
  });

  it('ante la duda asume TR-098, que es lo que usan estas ONUs', () => {
    expect(detectDataModelRoot(null)).toBe('InternetGatewayDevice');
    expect(detectDataModelRoot({})).toBe('InternetGatewayDevice');
  });
});

describe('cuándo reescribir las credenciales', () => {
  it('las escribe si el CPE no tiene ninguna', () => {
    expect(shouldWriteConnReqCredentials(null)).toBe(true);
    expect(shouldWriteConnReqCredentials('')).toBe(true);
    expect(shouldWriteConnReqCredentials('   ')).toBe(true);
  });

  it('las reescribe si son de otro sistema, como las migradas de SmartOLT', () => {
    expect(shouldWriteConnReqCredentials('RMS')).toBe(true);
    expect(shouldWriteConnReqCredentials('admin')).toBe(true);
  });

  it('no las toca si ya son las nuestras: la clave no se puede releer', () => {
    expect(shouldWriteConnReqCredentials(CONN_REQ_USERNAME)).toBe(false);
    expect(shouldWriteConnReqCredentials(` ${CONN_REQ_USERNAME} `)).toBe(false);
  });
});

describe('confiar en credenciales tras probe CR', () => {
  it('no confía si el usuario es ajeno (RMS / vacío)', () => {
    expect(
      connreqCredentialsTrusted({ currentUsername: 'RMS', reachable: true }),
    ).toBe(false);
    expect(
      connreqCredentialsTrusted({ currentUsername: null, reachable: undefined }),
    ).toBe(false);
  });

  it('confía en username nuestro si CR ok o sin probe', () => {
    expect(
      connreqCredentialsTrusted({
        currentUsername: CONN_REQ_USERNAME,
        reachable: true,
      }),
    ).toBe(true);
    expect(
      connreqCredentialsTrusted({
        currentUsername: CONN_REQ_USERNAME,
        reachable: undefined,
      }),
    ).toBe(true);
  });

  it('no confía si username es acs (fábrica Huawei) pero CR falló', () => {
    expect(
      connreqCredentialsTrusted({
        currentUsername: CONN_REQ_USERNAME,
        reachable: false,
      }),
    ).toBe(false);
  });
});

describe('intervalo de inform', () => {
  it('lo acorta cuando el CPE llega con un intervalo largo', () => {
    expect(shouldShortenInformInterval(43200)).toBe(true);
  });

  it('lo pone si el CPE no declara ninguno', () => {
    expect(shouldShortenInformInterval(null)).toBe(true);
    expect(shouldShortenInformInterval(Number.NaN)).toBe(true);
  });

  it('no lo alarga si el CPE ya informa más seguido', () => {
    expect(shouldShortenInformInterval(60)).toBe(false);
    expect(shouldShortenInformInterval(CONN_REQ_INFORM_INTERVAL_S)).toBe(false);
  });
});

describe('pares para SetParameterValues', () => {
  it('manda usuario y clave juntos', () => {
    const pv = buildConnReqParameterValues('FHTT968157D8');
    expect(pv.map(([p]) => p)).toEqual([
      'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
      'InternetGatewayDevice.ManagementServer.ConnectionRequestPassword',
    ]);
    expect(pv[1][1]).toBe(connReqPassword('FHTT968157D8'));
    expect(pv.every(([, , t]) => t === 'xsd:string')).toBe(true);
  });

  it('respeta la raíz TR-181 cuando toca', () => {
    const pv = buildConnReqParameterValues('FHTT968157D8', 'Device');
    expect(pv[0][0]).toBe('Device.ManagementServer.ConnectionRequestUsername');
  });
});
