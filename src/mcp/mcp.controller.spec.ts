import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { APP_CONFIG } from '../config/config';
import { RedmineGateway } from '../redmine/redmine.gateway';
import { RedmineError } from '../redmine/redmine.errors';
import { fileContent } from './tools/attachments.tools';

const NAMES = ['add_issue_comment', 'create_issue', 'delete_attachment', 'get_attachment', 'get_issue', 'get_project',
  'list_issues', 'list_projects', 'list_time_entries', 'log_time', 'update_issue'];
const gw: any = { getIssue: jest.fn(), createIssue: jest.fn(), getAttachment: jest.fn() };
let app: INestApplication;

const rpc = (body: object) =>
  request(app.getHttpServer()).post('/mcp').set('X-Redmine-API-Key', 'k')
    .set('Accept', 'application/json, text/event-stream').send(body);
const parse = (res: request.Response) => {
  const line = res.text.split('\n').find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.slice(5) : res.text);
};

beforeAll(async () => {
  process.env.REDMINE_URL = 'https://example.invalid';
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RedmineGateway).useValue(gw).compile();
  app = mod.createNestApplication({ bodyParser: false });
  configureApp(app, mod.get(APP_CONFIG));
  await app.init();
});
afterAll(() => app.close());

it.each([undefined, '', '   '])('401 when api key header is %p', async (key) => {
  const r = request(app.getHttpServer()).post('/mcp').send({});
  if (key !== undefined) r.set('X-Redmine-API-Key', key);
  await r.expect(401);
});

it('GET /mcp is 405', () => request(app.getHttpServer()).get('/mcp').expect(405));

it('tools/list returns all 11 tools', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  expect(parse(res).result.tools.map((t: any) => t.name).sort()).toEqual(NAMES);
});

it.each([
  ['text/plain', 'hello', { type: 'text', text: 'hello' }],
  ['image/png', 'PNG', { type: 'image', data: Buffer.from('PNG').toString('base64'), mimeType: 'image/png' }],
  ['application/zip', 'Z', { type: 'text', text: JSON.stringify({ filename: 'f', content_type: 'application/zip', content_base64: 'Wg==' }) }],
  ['image/svg+xml', '<svg/>', { type: 'text', text: JSON.stringify({ filename: 'f', content_type: 'image/svg+xml', content_base64: Buffer.from('<svg/>').toString('base64') }) }],
])('fileContent(%s)', (ct, data, expected) => {
  expect(fileContent({ filename: 'f', content_type: ct, data: Buffer.from(data) })).toEqual(expected);
});

it('get_attachment returns file content, or isError on RedmineError', async () => {
  gw.getAttachment.mockResolvedValueOnce({ filename: 'a.txt', content_type: 'text/plain', data: Buffer.from('hi') });
  const ok = parse(await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'get_attachment', arguments: { issue_id: 1, attachment_id: 7 } } })).result;
  expect(ok.content).toEqual([{ type: 'text', text: 'hi' }]);
  gw.getAttachment.mockRejectedValueOnce(new RedmineError('Not found'));
  const err = parse(await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'get_attachment', arguments: { issue_id: 2, attachment_id: 7 } } })).result;
  expect(err).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Not found' }] });
});

it('unexpected transport error => 500 JSON-RPC internal error', async () => {
  const spy = jest.spyOn(McpServer.prototype, 'connect').mockRejectedValueOnce(new Error('boom'));
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  spy.mockRestore();
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
});

it('accepts a 2 MB JSON body (body limit raised)', async () => {
  gw.createIssue.mockResolvedValue({ id: 1 });
  const big = Buffer.alloc(2 * 1024 * 1024, 1).toString('base64');
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_issue',
    arguments: { project: 1, subject: 's', attachments: [{ filename: 'a', content_base64: big }] } } });
  expect(res.status).not.toBe(413);
  expect(parse(res).result.isError).toBeUndefined();
});

it('RedmineError becomes isError tool result', async () => {
  gw.getIssue.mockRejectedValue(new RedmineError('Not found'));
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_issue', arguments: { id: 2 } } });
  const r = parse(res).result;
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toBe('Not found');
});
