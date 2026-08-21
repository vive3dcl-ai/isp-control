import {
  enrichOrphanModel,
  loadAcsModelsBySerial,
} from './onu-orphan-enrich.util';

describe('onu-orphan-enrich', () => {
  it('enrichOrphanModel: FHTT + HG6143D → library fiberhome-hg6143d', () => {
    const e = enrichOrphanModel('FHTT964E6978', 'HG6143D');
    expect(e.model).toBe('HG6143D');
    expect(e.modelSource).toBe('acs');
    expect(e.vendor).toBe('fiberhome');
    expect(e.driverId).toBe('fiberhome-hg6143d');
  });

  it('enrichOrphanModel: sin modelo → vendor + generic', () => {
    const e = enrichOrphanModel('FHTT964E6978', null);
    expect(e.model).toBeNull();
    expect(e.modelSource).toBeNull();
    expect(e.vendor).toBe('fiberhome');
    expect(e.driverId).toBe('generic-fiberhome');
  });

  it('enrichOrphanModel: fallback sighting / inventory', () => {
    const sight = enrichOrphanModel('HWTC3CD35FB2', null, {
      sightingModel: 'EG8145X6-10',
    });
    expect(sight.model).toBe('EG8145X6');
    expect(sight.modelSource).toBe('sighting');

    const inv = enrichOrphanModel('HWTC3CD35FB2', null, {
      inventoryModel: 'HG8145X6',
    });
    expect(inv.model).toBe('HG8145X6');
    expect(inv.modelSource).toBe('inventory');
  });

  it('enrichOrphanModel: ZTE F600 → generic-zte', () => {
    const e = enrichOrphanModel('ZTEG12345678', 'F600');
    expect(e.model).toBe('F600');
    expect(e.driverId).toBe('generic-zte');
    expect(e.vendor).toBe('zte');
  });

  it('loadAcsModelsBySerial mapea ProductClass por _id hex', async () => {
    const devices = [
      {
        _id: '000AC2-HG6143D-46485454964E6978',
        _deviceId: {
          _ProductClass: 'HG6143D',
          _SerialNumber: '46485454964E6978',
        },
      },
      {
        _id: 'C4EBFF-F6600P-5A544547D7180770',
        _deviceId: {
          _ProductClass: 'F6600P',
          _SerialNumber: '5A544547D7180770',
        },
      },
      {
        // Solo _id (proyección mínima) — ProductClass con guion
        _id: '00259E-EG8145X6-10-485754433CD35FB2',
      },
    ];
    const map = await loadAcsModelsBySerial(
      ['FHTT964E6978', 'ZTEGD7180770', 'HWTC3CD35FB2', 'UNKNOWN123'],
      {
        findDevices: async () => devices,
        findBySerial: async () => null,
      },
    );
    expect(map.get('FHTT964E6978')).toBe('HG6143D');
    expect(map.get('ZTEGD7180770')).toBe('F6600P');
    expect(map.get('HWTC3CD35FB2')).toBe('EG8145X6');
    expect(map.has('UNKNOWN123')).toBe(false);
  });

  it('loadAcsModelsBySerial completa con findBySerial si el scan falla', async () => {
    const map = await loadAcsModelsBySerial(['HWTC3CD35FB2'], {
      findDevices: async () => {
        throw new Error('nbi down');
      },
      findBySerial: async (sn) =>
        sn === 'HWTC3CD35FB2'
          ? {
              _id: '00259E-EG8145X6-10-485754433CD35FB2',
              _deviceId: { _ProductClass: 'EG8145X6-10' },
            }
          : null,
    });
    expect(map.get('HWTC3CD35FB2')).toBe('EG8145X6');
  });
});
