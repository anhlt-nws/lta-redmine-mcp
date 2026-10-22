import { type INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type AppConfig } from './config/config';

// Requires the app to be created with { bodyParser: false }. Base64 inflates files by 4/3.
export function configureApp(app: INestApplication, config: AppConfig): void {
  (app as NestExpressApplication).useBodyParser('json', { limit: `${Math.ceil((config.maxFileMb * 4) / 3) + 1}mb` });
}
