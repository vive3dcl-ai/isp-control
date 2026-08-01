import type { Repository } from 'typeorm';
import { saveDeviceIfPresent } from './device-persist.util';
import type { NetworkDevice } from './entities/network-device.entity';

function repoStub(exists: boolean) {
  return {
    existsBy: jest.fn().mockResolvedValue(exists),
    save: jest.fn().mockResolvedValue(undefined),
  } as unknown as Repository<NetworkDevice> & {
    existsBy: jest.Mock;
    save: jest.Mock;
  };
}

const device = { id: 'dev-1' } as NetworkDevice;

describe('saveDeviceIfPresent', () => {
  it('persists while the row exists', async () => {
    const repo = repoStub(true);
    await expect(saveDeviceIfPresent(repo, device)).resolves.toBe(true);
    expect(repo.save).toHaveBeenCalledWith(device);
  });

  it('never re-inserts a device deleted mid-probe', async () => {
    const repo = repoStub(false);
    await expect(saveDeviceIfPresent(repo, device)).resolves.toBe(false);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
