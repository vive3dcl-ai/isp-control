import {
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
}

/** Sync / ensure a single assigned device. */
export class SyncServiceVlanDeviceDto {
  @IsUUID()
  deviceId!: string;

  @IsIn(['olt', 'router'])
  kind!: 'olt' | 'router';

  /**
   * Required when kind=router and the VLAN does not yet exist on the MikroTik.
   * Parent physical/bridge port for `/interface/vlan` (e.g. ether1, bridge).
   */
  @IsOptional()
  @IsUUID()
  parentPortId?: string;
}
