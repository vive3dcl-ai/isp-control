import { BadRequestException } from '@nestjs/common';
import { isPlaceholderId, requireUuid } from './ai-tools.args.util';

describe('ai-tools.args.util', () => {
  it('detecta placeholders típicos del modelo', () => {
    expect(isPlaceholderId('<uuid>')).toBe(true);
    expect(isPlaceholderId('uuid')).toBe(true);
    expect(isPlaceholderId('<clientId>')).toBe(true);
    expect(isPlaceholderId('')).toBe(true);
    expect(isPlaceholderId('f87d0ba2-990c-42dc-9d93-58d81907d826')).toBe(
      false,
    );
  });

  it('requireUuid rechaza <uuid> con mensaje accionable', () => {
    expect(() => requireUuid('clientId', '<uuid>')).toThrow(BadRequestException);
    try {
      requireUuid('clientId', '<uuid>');
    } catch (e) {
      expect(String(e)).toMatch(/crm_search_clients/);
      expect(String(e)).not.toMatch(/invalid input syntax/);
    }
  });

  it('requireUuid acepta UUID v4', () => {
    expect(requireUuid('clientId', 'f87d0ba2-990c-42dc-9d93-58d81907d826')).toBe(
      'f87d0ba2-990c-42dc-9d93-58d81907d826',
    );
  });
});
