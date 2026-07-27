import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export const IP_POOL_PURPOSES = ['internet', 'management'] as const;
export type IpPoolPurposeDto = (typeof IP_POOL_PURPOSES)[number];

export class CreateIpPoolDto {
  @IsUUID()
  oltId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4094)
  vlanId!: number;

  @IsIn([...IP_POOL_PURPOSES])
  purpose!: IpPoolPurposeDto;

  @IsString()
  @MinLength(7)
  @MaxLength(45)
  gateway!: string;

  @Type(() => Number)
  @IsInt()
  @Min(8)
  @Max(30)
  prefix!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Required for purpose=internet (WAN). */
  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(45)
  dns1?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(45)
  dns2?: string;

  /** MikroTik that hosts the gateway (/ip/address on vlan_<id>). */
  @IsUUID()
  routerId!: string;
}

export class UpdateIpPoolDto {
  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(45)
  gateway?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(8)
  @Max(30)
  prefix?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4094)
  vlanId?: number;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(45)
  dns1?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(45)
  dns2?: string | null;

  @IsOptional()
  @IsUUID()
  routerId?: string;
}

export class SetOnuMgmtIpDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4094)
  vlanId?: number;
}

/** Enable/disable TR069 on an ONU (assigns mgmt IP + binds profile). */
export class SetOnuTr069Dto {
  @IsBoolean()
  enabled!: boolean;

  /** Required when enabling. */
  @IsOptional()
  @IsUUID()
  profileId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4094)
  vlanId?: number;
}

/** Change management and/or WAN VLAN pools on an ONU. */
export class SetOnuNetworkVlansDto {
  /** Management pool VLAN for this OLT (omit = no change). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4094)
  mgmtVlanId?: number;

  /**
   * Internet/WAN pool VLAN for this OLT.
   * Pass null explicitly to clear WAN assignment (JSON null).
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === ''
      ? value === ''
        ? null
        : value
      : Number(value),
  )
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(1)
  @Max(4094)
  wanVlanId?: number | null;

  /** TR069 profile to activate when mgmt VLAN is set (provisioning wizards). */
  @IsOptional()
  @IsUUID()
  tr069ProfileId?: string;
}
