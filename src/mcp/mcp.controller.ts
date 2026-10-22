import { Controller, Delete, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { type Request, type Response } from 'express';
import { RedmineGateway } from '../redmine/redmine.gateway';
import { registerAttachmentTools } from './tools/attachments.tools';
import { registerIssueTools } from './tools/issues.tools';
import { registerProjectTools } from './tools/projects.tools';
import { registerTimeEntryTools } from './tools/time-entries.tools';

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
    const server = new McpServer({ name: 'redmine', version: '0.1.0' });
    for (const register of [registerProjectTools, registerIssueTools, registerTimeEntryTools, registerAttachmentTools]) {
      register(server, this.gw, apiKey);
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
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
