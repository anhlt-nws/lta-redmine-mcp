import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { type DownloadedFile, type RedmineGateway } from '../../redmine/redmine.gateway';
import { toolResult } from './result';

export function fileContent(f: DownloadedFile): CallToolResult['content'][number] {
  const ct = f.content_type;
  if (ct.startsWith('text/') || ct === 'application/json' || ct === 'application/xml') {
    return { type: 'text', text: f.data.toString('utf8') };
  }
  if (ct.startsWith('image/')) return { type: 'image', data: f.data.toString('base64'), mimeType: ct };
  return { type: 'text', text: JSON.stringify({ filename: f.filename, content_type: ct, content_base64: f.data.toString('base64') }) };
}

const shape = { issue_id: z.number().int(), attachment_id: z.number().int() };

export function registerAttachmentTools(server: McpServer, gw: RedmineGateway, apiKey: string): void {
  server.registerTool('get_attachment', {
    description: 'Download an issue attachment (text and images inline, other types as base64 JSON).',
    inputSchema: shape,
  }, async (a) => {
    let file: DownloadedFile | undefined;
    const res = await toolResult(async () => { file = await gw.getAttachment(apiKey, a.issue_id, a.attachment_id); });
    return res.isError ? res : { content: [fileContent(file!)] };
  });
  server.registerTool('delete_attachment', { description: 'Delete an issue attachment.', inputSchema: shape },
    (a) => toolResult(() => gw.deleteAttachment(apiKey, a.issue_id, a.attachment_id)));
}
