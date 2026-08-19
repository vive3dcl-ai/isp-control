import { shouldApplyAcsModelToOnuType } from './onu-acs-model-reconcile.util';

describe('shouldApplyAcsModelToOnuType', () => {
  it('aplica ACS cuando el type actual es placeholder o vacío', () => {
    expect(shouldApplyAcsModelToOnuType(null, 'HG6143D')).toBe(true);
    expect(shouldApplyAcsModelToOnuType('N/A', 'HG6143D')).toBe(true);
    expect(shouldApplyAcsModelToOnuType('—', 'HG6143D')).toBe(true);
    expect(shouldApplyAcsModelToOnuType('na', 'EG8145X6-10')).toBe(true);
  });

  it('no aplica ProductClass placeholder del ACS', () => {
    expect(shouldApplyAcsModelToOnuType('F600', 'N/A')).toBe(false);
    expect(shouldApplyAcsModelToOnuType('N/A', 'N/A')).toBe(false);
  });

  it('aplica ACS cuando OLT puso un type OMCI distinto (F600 → HG6143D)', () => {
    expect(shouldApplyAcsModelToOnuType('HG6243C', 'EG8145X6-10')).toBe(true);
    expect(shouldApplyAcsModelToOnuType('F600', 'HG6143D')).toBe(true);
    expect(shouldApplyAcsModelToOnuType('f600', 'HG6143D')).toBe(true);
  });

  it('no cambia si ya coincide (case-insensitive)', () => {
    expect(shouldApplyAcsModelToOnuType('HG6143D', 'HG6143D')).toBe(false);
    expect(shouldApplyAcsModelToOnuType('hg6143d', 'HG6143D')).toBe(false);
  });

  it('no aplica sin ProductClass ACS', () => {
    expect(shouldApplyAcsModelToOnuType('F600', null)).toBe(false);
    expect(shouldApplyAcsModelToOnuType('F600', '')).toBe(false);
  });
});
