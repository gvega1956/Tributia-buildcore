import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto, RefreshDto } from './dto/login.dto.js';
import { Public } from '../iam/decorators/public.decorator.js';
import { RequireAuth } from '../iam/decorators/require-auth.decorator.js';
import type { JwtPayload } from '@tributia/core';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autenticación por email + contraseña' })
  @ApiResponse({ status: 200, description: 'Tokens emitidos' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar access token usando refresh token' })
  @ApiResponse({ status: 200, description: 'Nuevo par de tokens' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido o expirado' })
  refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body);
  }

  @RequireAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalidar todos los refresh tokens del usuario' })
  @ApiResponse({ status: 204, description: 'Sesión cerrada' })
  async logout(@Request() req: ExpressRequest & { user: JwtPayload }) {
    await this.authService.logout(req.user.sub, req.user.tenantId);
  }
}
