import { IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PushKeysDto {
  @IsString()
  @MaxLength(200)
  p256dh!: string;

  @IsString()
  @MaxLength(200)
  auth!: string;
}

export class UpsertPushSubscriptionDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  userAgent?: string;
}

export class RemovePushSubscriptionDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  endpoint!: string;
}
