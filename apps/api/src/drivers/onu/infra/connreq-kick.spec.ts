import {
  buildDigestAuthorization,
  factoryConnReqCandidates,
  newCnonce,
  parseDigestChallenge,
  requestCpeConnection,
} from './connreq-kick';

describe('reto digest', () => {
  it('lee realm, nonce, qop y opaque', () => {
    const c = parseDigestChallenge(
      'Digest realm="HuaweiHomeGateway", nonce="abc123", qop="auth", opaque="xyz"',
    );
    expect(c).toEqual({
      realm: 'HuaweiHomeGateway',
      nonce: 'abc123',
      qop: 'auth',
      opaque: 'xyz',
    });
  });

  it('acepta valores sin comillas', () => {
    expect(
      parseDigestChallenge('Digest realm=cpe, nonce=n1, qop=auth'),
    ).toEqual({ realm: 'cpe', nonce: 'n1', qop: 'auth', opaque: undefined });
  });

  it('lee algorithm cuando el CPE lo declara', () => {
    const c = parseDigestChallenge(
      'Digest realm="HuaweiHomeGateway", nonce="abc123", qop="auth", algorithm="MD5"',
    );
    expect(c?.algorithm).toBe('MD5');
  });

  it('descarta lo que no sirve para autenticarse', () => {
    expect(parseDigestChallenge('Basic realm="cpe"')).toBeNull();
    expect(parseDigestChallenge('Digest realm="cpe"')).toBeNull();
    expect(parseDigestChallenge(null)).toBeNull();
    expect(parseDigestChallenge('')).toBeNull();
  });
});

describe('cabecera de autorización', () => {
  const challenge = { realm: 'cpe', nonce: 'n1', qop: 'auth', opaque: 'op1' };

  it('incluye contador y nonce de cliente cuando hay qop', () => {
    const h = buildDigestAuthorization({
      challenge,
      uri: '/tr069',
      username: 'RMS',
      password: 'RMS',
      cnonce: 'c0ffee',
    });
    expect(h).toContain('username="RMS"');
    expect(h).toContain('uri="/tr069"');
    expect(h).toContain('qop=auth');
    expect(h).toContain('nc=00000001');
    expect(h).toContain('cnonce="c0ffee"');
    expect(h).toContain('opaque="op1"');
  });

  it('repite el algorithm del reto (Huawei lo exige)', () => {
    const h = buildDigestAuthorization({
      challenge: { realm: 'cpe', nonce: 'n1', qop: 'auth', algorithm: 'MD5' },
      uri: '/tr069',
      username: 'acs',
      password: 'clave',
      cnonce: 'c0ffee',
    });
    expect(h).toContain('algorithm=MD5');
  });

  it('manda algorithm=MD5 por defecto aunque el reto no lo declare', () => {
    const h = buildDigestAuthorization({
      challenge: { realm: 'cpe', nonce: 'n1', qop: 'auth' },
      uri: '/tr069',
      username: 'acs',
      password: 'clave',
      cnonce: 'c0ffee',
    });
    expect(h).toContain('algorithm=MD5');
  });

  it('omite qop cuando el CPE no lo pide', () => {
    const h = buildDigestAuthorization({
      challenge: { realm: 'cpe', nonce: 'n1' },
      uri: '/0',
      username: 'RMS',
      password: 'RMS',
      cnonce: 'c0ffee',
    });
    expect(h).not.toContain('qop');
    expect(h).not.toContain('cnonce');
  });

  it('cambia la respuesta si cambia la contraseña', () => {
    const base = {
      challenge,
      uri: '/tr069',
      username: 'RMS',
      cnonce: 'c0ffee',
    };
    const a = buildDigestAuthorization({ ...base, password: 'uno' });
    const b = buildDigestAuthorization({ ...base, password: 'dos' });
    expect(a).not.toBe(b);
  });

  it('no filtra la contraseña en la cabecera', () => {
    const h = buildDigestAuthorization({
      challenge,
      uri: '/tr069',
      username: 'RMS',
      password: 'secreto',
      cnonce: 'c0ffee',
    });
    expect(h).not.toContain('secreto');
  });
});

describe('credenciales a probar', () => {
  it('empieza por las del propio equipo, que suelen repetir el usuario', () => {
    const c = factoryConnReqCandidates('smartolt', 'Aclave');
    expect(c[0]).toEqual({ username: 'smartolt', password: 'smartolt' });
    expect(c[1]).toEqual({ username: 'smartolt', password: '' });
  });

  it('no repite pares cuando el usuario ya está en la lista fija', () => {
    const c = factoryConnReqCandidates('RMS', 'Aclave');
    const pares = c.map((x) => `${x.username}:${x.password}`);
    expect(new Set(pares).size).toBe(pares.length);
  });

  it('sirve aunque el CPE no declare usuario', () => {
    const c = factoryConnReqCandidates(null, 'Aclave');
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((x) => x.username)).toBe(true);
  });

  it('deja las nuestras al final, por si sólo hay que despertarlo', () => {
    const c = factoryConnReqCandidates('RMS', 'Aclave');
    expect(c[c.length - 1]).toEqual({ username: 'acs', password: 'Aclave' });
  });
});

describe('nonce de cliente', () => {
  it('no se repite entre llamadas', () => {
    expect(newCnonce()).not.toBe(newCnonce());
  });
});

describe('petición de conexión', () => {
  const URL_CPE = 'http://30.30.20.14:7547/token';
  const reply = (status: number, wwwAuth?: string) =>
    ({
      status,
      headers: { get: () => wwwAuth ?? null },
    }) as unknown as Response;
  const digest = 'Digest realm="cpe", nonce="n1", qop="auth"';

  it('acepta cuando el CPE contesta al digest', async () => {
    const calls: Array<RequestInit | undefined> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(init);
      return calls.length === 1 ? reply(401, digest) : reply(200);
    }) as unknown as typeof fetch;

    const res = await requestCpeConnection(URL_CPE, 'acs', 'clave', {
      fetchImpl,
    });
    expect(res.ok).toBe(true);
    expect(calls[1]?.headers).toMatchObject({
      Authorization: expect.stringContaining('username="acs"') as string,
    });
  });

  it('distingue la contraseña rechazada de la falta de camino', async () => {
    const rechaza = (async (_url: string, init?: RequestInit) =>
      init?.headers
        ? reply(401, digest)
        : reply(401, digest)) as unknown as typeof fetch;
    const sinCamino = (async () => {
      throw new Error('timeout');
    }) as unknown as typeof fetch;

    await expect(
      requestCpeConnection(URL_CPE, 'acs', 'mala', { fetchImpl: rechaza }),
    ).resolves.toMatchObject({ ok: false, reason: 'credenciales' });
    await expect(
      requestCpeConnection(URL_CPE, 'acs', 'clave', { fetchImpl: sinCamino }),
    ).resolves.toMatchObject({ ok: false, reason: 'sin-camino' });
  });

  it('reconoce el 401 sin reto con que estos CPE cortan las ráfagas', async () => {
    const fetchImpl = (async () => reply(401)) as unknown as typeof fetch;
    await expect(
      requestCpeConnection(URL_CPE, 'acs', 'clave', { fetchImpl }),
    ).resolves.toMatchObject({ ok: false, reason: 'limitado' });
  });

  it('no intenta nada sin ConnectionRequestURL', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(
      requestCpeConnection(null, 'acs', 'clave', { fetchImpl }),
    ).resolves.toMatchObject({ ok: false, reason: 'sin-url' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
