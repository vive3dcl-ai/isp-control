import {
  isPlaceholderOnuModel,
  normalizeOnuModelName,
  resolveOnuCatalogDisplayImage,
  resolveOnuTypeDisplayImage,
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
    expect(usableOnuModelName('sn')).toBeNull();
    expect(usableOnuModelName('serial')).toBeNull();
    expect(usableOnuModelName('ProductClass')).toBeNull();
  });

  it('normaliza modelos reales y quita revisión HW -NN', () => {
    expect(usableOnuModelName('EG8145X6-10')).toBe('EG8145X6');
    expect(usableOnuModelName('HG8145X6-13')).toBe('HG8145X6');
    expect(usableOnuModelName('HG8145X6')).toBe('HG8145X6');
    expect(usableOnuModelName('Huawei-HG8145X6-10')).toBe('HG8145X6');
    expect(usableOnuModelName('HG9')).toBe('HG9');
    expect(normalizeOnuModelName('F660')).toBe('F660');
  });

  it('isPlaceholderOnuModel', () => {
    expect(isPlaceholderOnuModel('N/A')).toBe(true);
    expect(isPlaceholderOnuModel('sn')).toBe(true);
    expect(isPlaceholderOnuModel('HG8245W5')).toBe(false);
    expect(isPlaceholderOnuModel('HG9')).toBe(false);
  });
});

describe('resolveOnuTypeDisplayImage', () => {
  it('uses default SVG when useDefaultImage is true', () => {
    expect(
      resolveOnuTypeDisplayImage({
        vendor: 'huawei',
        capability: 'bridging_routing',
        useDefaultImage: true,
        imageUrl: 'data:image/png;base64,abc',
      }),
    ).toBe('/onu/huawei-hgu.svg');
  });

  it('uses custom data URL when useDefaultImage is false', () => {
    const custom = 'data:image/png;base64,abc';
    expect(
      resolveOnuTypeDisplayImage({
        vendor: 'zte',
        capability: 'bridging_routing',
        useDefaultImage: false,
        imageUrl: custom,
      }),
    ).toBe(custom);
  });
});

describe('resolveOnuCatalogDisplayImage', () => {
  it('prefers custom photo over SVG key', () => {
    const custom = 'data:image/png;base64,xyz';
    expect(
      resolveOnuCatalogDisplayImage({
        imageKey: 'huawei-hgu',
        customImageUrl: custom,
      }),
    ).toBe(custom);
  });

  it('falls back to SVG when no custom photo', () => {
    expect(
      resolveOnuCatalogDisplayImage({
        imageKey: 'zte-sfu',
        customImageUrl: null,
      }),
    ).toBe('/onu/zte-sfu.svg');
  });
});
