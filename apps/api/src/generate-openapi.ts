import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module.js';

async function generate() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  const config = new DocumentBuilder()
    .setTitle('Tributia BuildCore API')
    .setDescription('Plataforma operativa integral para empresas constructoras')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token JWT' },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const outPath = resolve(process.cwd(), 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2));

  const routeCount = Object.keys(document.paths).length;
  const operationCount = Object.values(document.paths).reduce(
    (acc, path) => acc + Object.keys(path ?? {}).length,
    0,
  );

  console.log(`✓ OpenAPI spec escrito en ${outPath}`);
  console.log(`  Rutas:      ${routeCount}`);
  console.log(`  Operaciones: ${operationCount}`);

  await app.close();
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
