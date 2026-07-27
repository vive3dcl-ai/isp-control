import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ConfigureSuspensionMikrotikDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  routerIds: string[];
}
