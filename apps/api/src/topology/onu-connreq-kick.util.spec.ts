import {
  buildDigestAuthorization,
  factoryConnReqCandidates,
  newCnonce,
  parseDigestChallenge,
} from './onu-connreq-kick.util';

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
    expect(parseDigestChallenge('Digest realm=cpe, nonce=n1, qop=auth')).toEqual(
      { realm: 'cpe', nonce: 'n1', qop: 'auth', opaque: undefined },
    );
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
