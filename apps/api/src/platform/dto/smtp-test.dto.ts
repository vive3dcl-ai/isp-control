import { IsEmail } from 'class-validator';

export class SmtpTestDto {
  @IsEmail()
  to: string;
}
