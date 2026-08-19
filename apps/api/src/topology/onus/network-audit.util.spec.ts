import { clipAuditDetail, errorMessage } from './network-audit.util';

describe('clipAuditDetail', () => {
  it('omite claves de secreto', () => {
    expect(
      clipAuditDetail({
        message: 'ok',
        password: 'secret',
        enablePassword: 'x',
        community: 'public',
      }),
    ).toEqual({ message: 'ok' });
  });

  it('trunca strings largos', () => {
    const d = clipAuditDetail({ message: 'a'.repeat(400) });
    expect(String(d.message).length).toBeLessThanOrEqual(241);
  });

  it('acepta null', () => {
    expect(clipAuditDetail(null)).toEqual({});
  });
});

describe('errorMessage', () => {
  it('usa Error.message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
});
