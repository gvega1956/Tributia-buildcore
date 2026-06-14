import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

export interface UploadResult {
  key: string;
  bucket: string;
  contentType: string;
  size: number;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client!: S3Client;
  private bucket!: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const endpoint = this.config.getOrThrow<string>('STORAGE_ENDPOINT');
    const accessKeyId = this.config.getOrThrow<string>('STORAGE_ACCESS_KEY');
    const secretAccessKey = this.config.getOrThrow<string>('STORAGE_SECRET_KEY');
    this.bucket = this.config.getOrThrow<string>('STORAGE_BUCKET');

    this.client = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // required for MinIO
    });

    // En entorno de pruebas el servidor MinIO puede no estar corriendo.
    // La inicialización falla en silencio para no bloquear las pruebas de otros módulos.
    try {
      await this.ensureBucket();
    } catch (err) {
      this.logger.warn(`Storage no disponible al iniciar: ${(err as Error).message}`);
    }
  }

  /**
   * Sube un objeto al bucket. La key debe seguir la convención:
   *   {tenantId}/{entidadTipo}/{archivoId}/v{n}/{nombre}
   */
  async upload(
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<UploadResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(metadata ? { Metadata: metadata } : {}),
      }),
    );

    this.logger.debug(`Uploaded object: ${key} (${body.length} bytes)`);

    return { key, bucket: this.bucket, contentType, size: body.length };
  }

  /**
   * Genera una URL firmada para descarga directa (válida por expiresIn segundos).
   * El cliente descarga directamente desde MinIO/S3 sin pasar por la API.
   */
  async getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Elimina un objeto del bucket. Solo para casos de limpieza de tests o
   * reversa explícita autorizada — en producción preferir soft-delete en BD.
   */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.debug(`Deleted object: ${key}`);
  }

  get bucketName(): string {
    return this.bucket;
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Storage bucket '${this.bucket}' verified`);
    } catch {
      // Bucket doesn't exist — create it (MinIO development only)
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Storage bucket '${this.bucket}' created`);
    }
  }
}
