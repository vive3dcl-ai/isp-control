import type { Repository } from 'typeorm';
import type { NetworkDevice } from './entities/network-device.entity';

/**
 * Save a device only while its row still exists.
 *
 * Probes, CLI/SNMP commands and inventory refreshes load a device, spend
 * seconds (sometimes minutes) talking to the equipment and then persist the
 * result. If the operator deletes the device in that window, TypeORM's `save`
 * re-inserts the row from the in-memory entity and the deleted asset comes
 * back. Callers that can outlive the row must go through this helper.
 *
 * Returns false when the row is gone, so callers can skip follow-up work.
 */
export async function saveDeviceIfPresent(
  devices: Repository<NetworkDevice>,
  device: NetworkDevice,
): Promise<boolean> {
  if (!(await devices.existsBy({ id: device.id }))) return false;
  await devices.save(device);
  return true;
}
