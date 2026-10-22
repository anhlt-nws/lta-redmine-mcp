import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type RedmineGateway } from '../../redmine/redmine.gateway';
import { toolResult } from './result';

export const projectRef = z.union([z.number().int(), z.string()]).describe('Project id or identifier');
export const pageShape = {
  limit: z.number().int().min(1).max(100).optional().describe('Page size (1-100, default 25)'),
  offset: z.number().int().min(0).optional(),
};

export function registerProjectTools(server: McpServer, gw: RedmineGateway, apiKey: string): void {
  server.registerTool('list_projects', { description: 'List projects visible to you.', inputSchema: pageShape },
    (a) => toolResult(() => gw.listProjects(apiKey, a)));
  server.registerTool('get_project', { description: 'Get one project.', inputSchema: { project: projectRef } },
    (a) => toolResult(() => gw.getProject(apiKey, a.project)));
}
