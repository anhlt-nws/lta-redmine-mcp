import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type RedmineGateway } from '../../redmine/redmine.gateway';
import { pageShape, projectRef } from './projects.tools';
import { toolResult } from './result';

export function registerTimeEntryTools(server: McpServer, gw: RedmineGateway, apiKey: string): void {
  server.registerTool('list_time_entries', {
    description: 'List time entries. user_id: id or "me". from/to: YYYY-MM-DD.',
    inputSchema: {
      project: projectRef.optional(),
      issue_id: z.number().int().optional(),
      user_id: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      ...pageShape,
    },
  }, (a) => toolResult(() => gw.listTimeEntries(apiKey, a)));

  server.registerTool('log_time', {
    description: 'Log time. Provide issue_id or project. spent_on: YYYY-MM-DD (default today).',
    inputSchema: {
      issue_id: z.number().int().optional(),
      project: projectRef.optional(),
      hours: z.number().positive(),
      spent_on: z.string().optional(),
      activity_id: z.number().int().optional(),
      comments: z.string().optional(),
    },
  }, (a) => toolResult(() => gw.logTime(apiKey, a)));
}
