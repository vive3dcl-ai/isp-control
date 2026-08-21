import { isPonMoved, ponPortKey } from './onu-pon-moved.util';

describe('ponPortKey', () => {
  it('usa board/port cuando existen', () => {
    expect(
      ponPortKey({ oltId: 'olt-a', board: '2', port: '14' }),
    ).toBe('olt-a|2|14');
  });

  it('parsea onuIf / oltIf ZTE', () => {
    expect(
      ponPortKey({
        oltId: 'olt-a',
        onuIf: 'gpon-onu_1/2/14:5',
      }),
    ).toBe('olt-a|2|14');
    expect(
      ponPortKey({
        oltId: 'olt-a',
        oltIf: 'gpon-olt_1/2/9',
      }),
    ).toBe('olt-a|2|9');
  });
});

describe('isPonMoved', () => {
  it('false si mismo OLT y mismo puerto', () => {
    expect(
      isPonMoved(
        { oltId: 'olt-a', board: '1', port: '3', onuIf: 'gpon-onu_1/1/3:2' },
        { oltId: 'olt-a', board: '1', port: '3', oltIf: 'gpon-olt_1/1/3' },
      ),
    ).toBe(false);
  });

  it('true si cambió de puerto en la misma OLT', () => {
    expect(
      isPonMoved(
        { oltId: 'olt-a', board: '1', port: '3', onuIf: 'gpon-onu_1/1/3:2' },
        { oltId: 'olt-a', board: '2', port: '8', oltIf: 'gpon-olt_1/2/8' },
      ),
    ).toBe(true);
  });

  it('true si cambió de OLT', () => {
    expect(
      isPonMoved(
        { oltId: 'olt-a', board: '1', port: '3' },
        { oltId: 'olt-b', board: '1', port: '3' },
      ),
    ).toBe(true);
  });

  it('true por OLT distinta aunque falten board/port', () => {
    expect(
      isPonMoved({ oltId: 'olt-a' }, { oltId: 'olt-b' }),
    ).toBe(true);
  });

  it('false si no hay claves ni cambio de OLT', () => {
    expect(
      isPonMoved({ oltId: 'olt-a' }, { oltId: 'olt-a' }),
    ).toBe(false);
  });
});
