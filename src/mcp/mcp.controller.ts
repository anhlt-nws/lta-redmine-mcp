import { Controller, Delete, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { type Request, type Response } from 'express';
import { RedmineGateway } from '../redmine/redmine.gateway';
import { createMcpServer } from './mcp.server';

@Controller('mcp')
export class McpController {
  constructor(private readonly gw: RedmineGateway) {}

  // Stateless: a fresh server + transport per request, bound to the caller's own API key.
  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const apiKey = req.header('x-redmine-api-key')?.trim();
    if (!apiKey) {
      res.status(401).json({ error: 'Missing X-Redmine-API-Key' });
      return;
    }
    const server = createMcpServer(this.gw, apiKey);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (res.headersSent) res.end();
      else res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }

  @Get()
  @HttpCode(405)
  get() {
    return { error: 'Method not allowed' };
  }

  @Delete()
  @HttpCode(405)
  del() {
    return { error: 'Method not allowed' };
  }
}
