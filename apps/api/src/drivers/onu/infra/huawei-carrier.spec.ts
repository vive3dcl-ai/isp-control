import {
  huaweiInternetCarrierOk,
  inspectHuaweiInternetCarrier,
} from './huawei-carrier';

function leaf(value: unknown) {
  return { _value: value };
}

function deviceWithInternet(opts: {
  status: string;
  err?: string;
}) {
  return {
    InternetGatewayDevice: {
      WANDevice: {
        1: {
          WANConnectionDevice: {
            3: {
              WANIPConnection: {
                1: {
                  X_HW_SERVICELIST: leaf('INTERNET'),
                  ConnectionStatus: leaf(opts.status),
                  LastConnectionError: leaf(opts.err ?? 'ERROR_NONE'),
                  ExternalIPAddress: leaf('40.40.20.54'),
                },
              },
            },
          },
        },
      },
    },
  };
}

describe('huaweiInternetCarrierOk', () => {
  it('Connected sin NO_CARRIER → ok', () => {
    expect(
      huaweiInternetCarrierOk(
        deviceWithInternet({ status: 'Connected' }),
      ),
    ).toBe(true);
  });

  it('ERROR_NO_CARRIER → no ok', () => {
    const d = deviceWithInternet({
      status: 'Connecting',
      err: 'ERROR_NO_CARRIER',
    });
    expect(huaweiInternetCarrierOk(d)).toBe(false);
    expect(inspectHuaweiInternetCarrier(d)?.lastError).toBe(
      'ERROR_NO_CARRIER',
    );
  });

  it('sin ConnectionStatus → no ok (árbol parcial post-SPV)', () => {
    const d = deviceWithInternet({ status: '' });
    // leaf('') → status ''
    expect(huaweiInternetCarrierOk(d)).toBe(false);
  });

  it('sin WAN INTERNET → undefined', () => {
    expect(huaweiInternetCarrierOk({})).toBeUndefined();
  });
});
