import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
}

export class UpdateServiceVlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

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

  /** Bridge name on RouterOS switch (default `bridge`). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bridge?: string;

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
