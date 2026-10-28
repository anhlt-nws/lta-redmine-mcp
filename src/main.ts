#!/usr/bin/env node
import { NestFactory } from '@nestjs/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { type AppConfig, parseConfig } from './config/config';
import { createMcpServer } from './mcp/mcp.server';
import { RedmineGateway } from './redmine/redmine.gateway';

async function bootstrap() {
  let config: AppConfig;
  try {
    config = parseConfig(process.env, process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }

  if (config.transport === 'stdio') {
    // stdout carries the protocol; Nest writes only 'error' to stderr, every other level to stdout.
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
    await createMcpServer(app.get(RedmineGateway), config.apiKey!).connect(new StdioServerTransport());
    return;
  }

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app, config);
  await app.listen(config.port);
}
bootstrap();
