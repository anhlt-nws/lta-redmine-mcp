import { Module } from '@nestjs/common';
import { RedmineModule } from '../redmine/redmine.module';
import { McpController } from './mcp.controller';

@Module({ imports: [RedmineModule], controllers: [McpController] })
export class McpModule {}
