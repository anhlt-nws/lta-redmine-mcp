import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type RedmineGateway } from '../redmine/redmine.gateway';
import { registerAttachmentTools } from './tools/attachments.tools';
import { registerIssueTools } from './tools/issues.tools';
import { registerProjectTools } from './tools/projects.tools';
import { registerTimeEntryTools } from './tools/time-entries.tools';

// Shared by the HTTP controller (one server per request) and stdio (one server per process).
export function createMcpServer(gw: RedmineGateway, apiKey: string): McpServer {
  const server = new McpServer({ name: 'redmine', version: '0.1.0' });
  for (const register of [registerProjectTools, registerIssueTools, registerTimeEntryTools, registerAttachmentTools]) {
    register(server, gw, apiKey);
  }
  return server;
}
