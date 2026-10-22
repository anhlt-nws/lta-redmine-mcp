import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type RedmineGateway } from '../../redmine/redmine.gateway';
import { pageShape, projectRef } from './projects.tools';
import { toolResult } from './result';

const attachments = z.array(z.object({
  filename: z.string(),
  content_base64: z.string().describe('File content, base64-encoded'),
  content_type: z.string().optional(),
  description: z.string().optional(),
})).optional().describe('Files to attach');

const id = z.number().int();
const fields = {
  description: z.string().optional(),
  status_id: id.optional(),
  priority_id: id.optional(),
  assigned_to_id: id.optional(),
  attachments,
};

export function registerIssueTools(server: McpServer, gw: RedmineGateway, apiKey: string): void {
  server.registerTool('list_issues', {
    description: 'List issues. status: open|closed|*|<status id> (default open). assigned_to: user id or "me". subject: substring match.',
    inputSchema: {
      project: projectRef.optional(),
      status: z.string().optional(),
      assigned_to: z.string().optional(),
      subject: z.string().optional(),
      ...pageShape,
    },
  }, (a) => toolResult(() => gw.listIssues(apiKey, a)));

  server.registerTool('get_issue', { description: 'Get an issue with its comments (journals) and attachments.', inputSchema: { id } },
    (a) => toolResult(() => gw.getIssue(apiKey, a.id)));

  server.registerTool('create_issue', {
    description: 'Create an issue. project accepts id or identifier.',
    inputSchema: { project: projectRef, subject: z.string(), tracker_id: id.optional(), ...fields },
  }, (a) => toolResult(() => gw.createIssue(apiKey, a)));

  server.registerTool('update_issue', {
    description: 'Update an issue (all fields optional). notes adds a comment; project moves the issue.',
    inputSchema: {
      id,
      project: projectRef.optional(),
      subject: z.string().optional(),
      done_ratio: z.number().int().min(0).max(100).optional(),
      notes: z.string().optional(),
      ...fields,
    },
  }, (a) => toolResult(() => {
    const { id: issueId, ...rest } = a;
    return gw.updateIssue(apiKey, issueId, rest);
  }));

  server.registerTool('add_issue_comment', { description: 'Add a comment to an issue.', inputSchema: { id, notes: z.string() } },
    (a) => toolResult(() => gw.addIssueComment(apiKey, a.id, a.notes)));
}
