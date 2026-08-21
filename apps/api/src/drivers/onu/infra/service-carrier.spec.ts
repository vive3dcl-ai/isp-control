import { serviceWanCarrierOk } from './service-carrier';

function leaf(value: unknown) {
  return { _value: value };
}

describe('serviceWanCarrierOk', () => {
  it('Huawei INTERNET + ERROR_NO_CARRIER → false', () => {
    const device = {
      InternetGatewayDevice: {
        WANDevice: {
          1: {
            WANConnectionDevice: {
              3: {
                WANIPConnection: {
                  1: {
                    X_HW_SERVICELIST: leaf('INTERNET'),
                    ConnectionStatus: leaf('Connecting'),
                    LastConnectionError: leaf('ERROR_NO_CARRIER'),
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(serviceWanCarrierOk(device)).toBe(false);
  });

  it('sin WAN de servicio → undefined', () => {
    expect(serviceWanCarrierOk({})).toBeUndefined();
  });
});
