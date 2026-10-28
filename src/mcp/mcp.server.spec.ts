import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './mcp.server';

it('registers all 11 tools', async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({} as any, 'k');
  const client = new Client({ name: 't', version: '0' });
  await server.connect(serverSide);
  await client.connect(clientSide);
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  expect(names).toEqual(['add_issue_comment', 'create_issue', 'delete_attachment', 'get_attachment', 'get_issue',
    'get_project', 'list_issues', 'list_projects', 'list_time_entries', 'log_time', 'update_issue']);
  await client.close();
});
