import {
  CONN_REQ_USERNAME,
  buildConnReqParameterValues,
  connReqCredentials,
  connReqPassword,
  detectDataModelRoot,
} from './onu-connreq-credentials.util';

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

  it('ante la duda asume TR-098, que es lo que usan estas ONUs', () => {
    expect(detectDataModelRoot(null)).toBe('InternetGatewayDevice');
    expect(detectDataModelRoot({})).toBe('InternetGatewayDevice');
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
    expect(pv[0][0]).toBe(
      'Device.ManagementServer.ConnectionRequestUsername',
    );
  });
});
