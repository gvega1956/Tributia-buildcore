import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'API operativa' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Tributia BuildCore API',
      version: '1.0.0',
    };
  }
}
