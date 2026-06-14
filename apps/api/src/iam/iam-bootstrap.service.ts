import { Injectable, OnApplicationBootstrap, Logger, type Type } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './decorators/require-permission.decorator.js';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import { IS_AUTH_ONLY_KEY } from './decorators/require-auth.decorator.js';

/**
 * Valida en arranque que todo endpoint HTTP tenga declarado exactamente uno de:
 *   @Public()          — ruta pública
 *   @RequireAuth()     — requiere JWT pero no permiso específico
 *   @RequirePermission — requiere JWT + permiso de negocio
 *
 * Si algún endpoint no tiene ninguno, el proceso muere con un mensaje claro.
 * Esto convierte el olvido de declarar un permiso en un error de compilación
 * de facto, imposible de ignorar.
 */
@Injectable()
export class IamBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IamBootstrapService.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const undeclared: string[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      const rawInstance: unknown = wrapper.instance;
      if (!rawInstance || typeof rawInstance !== 'object') continue;
      const prototype = Object.getPrototypeOf(rawInstance) as object;
      const ctor = (rawInstance as Record<string, unknown>)['constructor'] as (Type<unknown> & { name: string });
      const controllerName = ctor.name;

      // Comprobar si toda la clase está marcada a nivel de controlador
      const classIsPublic = this.reflector.get<boolean>(IS_PUBLIC_KEY, ctor);
      const classIsAuthOnly = this.reflector.get<boolean>(IS_AUTH_ONLY_KEY, ctor);
      const classPermission = this.reflector.get<string>(PERMISSION_KEY, ctor);
      if (classIsPublic || classIsAuthOnly || classPermission) continue;

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;

        // Solo verificar métodos que son route handlers (tienen path metadata)
        const hasPath = Reflect.hasMetadata('path', handler);
        if (!hasPath) continue;

        const isPublic = this.reflector.get<boolean>(IS_PUBLIC_KEY, handler);
        const isAuthOnly = this.reflector.get<boolean>(IS_AUTH_ONLY_KEY, handler);
        const permission = this.reflector.get<string>(PERMISSION_KEY, handler);

        if (!isPublic && !isAuthOnly && !permission) {
          undeclared.push(`${controllerName}.${methodName}`);
        }
      }
    }

    if (undeclared.length > 0) {
      const list = undeclared.map((s) => `  • ${s}`).join('\n');
      // process.exit es la señal más clara posible; throw podría quedar silenciado.
      this.logger.error(
        `SEGURIDAD — Los siguientes endpoints no tienen @RequirePermission, @RequireAuth, ni @Public:\n${list}\n` +
        `Declare uno de estos decoradores antes de arrancar.`,
      );
      process.exit(1);
    }

    this.logger.log('Validación de permisos de endpoints: OK');
  }
}
