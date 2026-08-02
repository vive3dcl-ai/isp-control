import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const SERVICE_VLAN_PURPOSES = ['internet', 'management', 'tv'] as const;
export type ServiceVlanPurpose = (typeof SERVICE_VLAN_PURPOSES)[number];

export class CreateServiceVlanDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4094)
  vlanId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsIn(SERVICE_VLAN_PURPOSES)
  purpose?: ServiceVlanPurpose;
}

export class UpdateServiceVlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @IsOptional()
  @IsIn(SERVICE_VLAN_PURPOSES)
  purpose?: ServiceVlanPurpose;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  oltIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  routerIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  switchIds?: string[];
}

export class SwitchVlanPortDto {
  @IsUUID()
  portId!: string;

  @IsIn(['tagged', 'untagged'])
  mode!: 'tagged' | 'untagged';
}

/** Sync / ensure a single assigned device. */
export class SyncServiceVlanDeviceDto {
  @IsUUID()
  deviceId!: string;

  @IsIn(['olt', 'router', 'switch'])
  kind!: 'olt' | 'router' | 'switch';

  /**
   * Required when kind=router and the VLAN does not yet exist on the MikroTik.
   * Parent physical/bridge port for `/interface/vlan` (e.g. ether1, bridge).
   */
  @IsOptional()
  @IsUUID()
  parentPortId?: string;

  /**
   * Bridge name on a RouterOS switch. Omit to reuse the bridge the selected
   * ports already belong to.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bridge?: string;

  /**
   * Allow creating `bridge` when it does not exist yet. Off by default so a
   * typo can never spawn a second bridge and strand the ports in it.
   */
  @IsOptional()
  @IsBoolean()
  createBridge?: boolean;

  /**
   * Only for kind=olt: uplink ifNames (gei_/xgei_ on ZTE) that must carry this
   * VLAN upstream. Creating the VLAN alone leaves it trapped inside the OLT.
   * Omit to leave the current trunk membership untouched; send an empty array
   * to remove the VLAN from every uplink.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  uplinks?: string[];

  /**
   * Required when kind=switch: physical ports and tagged/untagged membership
   * for `/interface/bridge/vlan`.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SwitchVlanPortDto)
  ports?: SwitchVlanPortDto[];
}
