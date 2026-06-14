import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, MinLength, IsUUID } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'constructora-norte' })
  @IsString()
  tenantSlug!: string;

  @ApiProperty({ example: 'admin@constructora.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'S3cret!23', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'UUID del refresh token recibido en /auth/login' })
  @IsUUID()
  refreshToken!: string;
}
