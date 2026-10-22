import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { McpModule } from './mcp/mcp.module';

@Module({ imports: [ConfigModule, McpModule] })
export class AppModule {}
