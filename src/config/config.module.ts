import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, parseConfig } from './config';

const provider = { provide: APP_CONFIG, useFactory: () => parseConfig(process.env) };

@Global()
@Module({ providers: [provider], exports: [provider] })
export class ConfigModule {}
