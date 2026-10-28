import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, parseConfig } from './config';

const provider = { provide: APP_CONFIG, useFactory: () => parseConfig(process.env, process.argv.slice(2)) };

@Global()
@Module({ providers: [provider], exports: [provider] })
export class ConfigModule {}
