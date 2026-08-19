import {
  isPlaceholderOnuModel,
  usableOnuModelName,
} from './onu-model-catalog';

describe('usableOnuModelName', () => {
  it('rechaza placeholders', () => {
    expect(usableOnuModelName('N/A')).toBeNull();
    expect(usableOnuModelName('n/a')).toBeNull();
    expect(usableOnuModelName('—')).toBeNull();
    expect(usableOnuModelName('-')).toBeNull();
    expect(usableOnuModelName('')).toBeNull();
    expect(usableOnuModelName(null)).toBeNull();
  });

  it('normaliza modelos reales', () => {
    expect(usableOnuModelName('EG8145X6-10')).toBe('EG8145X6-10');
    expect(usableOnuModelName('Huawei-HG8145X6')).toBe('HG8145X6');
  });

  it('isPlaceholderOnuModel', () => {
    expect(isPlaceholderOnuModel('N/A')).toBe(true);
    expect(isPlaceholderOnuModel('HG8245W5')).toBe(false);
  });
});
