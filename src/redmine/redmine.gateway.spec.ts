import { parseConfig } from '../config/config';
import { mockFetch } from './fetch-mock';
import { ProjectAccessPolicy } from './project-access.policy';
import { RedmineError } from './redmine.errors';
import { RedmineGateway } from './redmine.gateway';

const config = parseConfig({ REDMINE_URL: 'https://rm.example.com/', BLOCKED_PROJECT_IDS: '12' });
const gw = new RedmineGateway(config, new ProjectAccessPolicy(config));

afterEach(() => jest.restoreAllMocks());

it('sends api key header, no double slash', async () => {
  const m = mockFetch({ 'GET /projects.json': { body: { projects: [], total_count: 0 } } });
  await gw.listProjects('k', {});
  expect(m.calls[0].url.href).toBe('https://rm.example.com/projects.json?limit=25&offset=0');
  expect(m.calls[0].headers['X-Redmine-API-Key']).toBe('k');
});
it('listProjects filters blocked, has_more from total_count', async () => {
  mockFetch({ 'GET /projects.json': { body: { projects: [{ id: 12 }, { id: 13 }], total_count: 30 } } });
  expect(await gw.listProjects('k', { limit: 2 })).toEqual({ items: [{ id: 13 }], has_more: true });
});
it.each(['12', 12, 'secret-proj'])('getProject(%p) on blocked project => Not found', async (ref) => {
  mockFetch({ [`GET /projects/${ref}.json`]: { body: { project: { id: 12, identifier: 'secret-proj' } } } });
  await expect(gw.getProject('k', ref)).rejects.toThrow(new RedmineError('Not found'));
});
it('non-JSON 2xx response => RedmineError hinting at REDMINE_URL', async () => {
  mockFetch({ 'GET /projects/x.json': { raw: Buffer.from('<html>login</html>'), contentType: 'text/html' } });
  await expect(gw.getProject('k', 'x')).rejects.toThrow(
    new RedmineError('Redmine returned a non-JSON response (check REDMINE_URL)'),
  );
});
it('getProject returns allowed project; resolveProjectId returns id', async () => {
  mockFetch({ 'GET /projects/x.json': { body: { project: { id: 5 } } } });
  expect(await gw.getProject('k', 'x')).toEqual({ id: 5 });
  expect(await gw.resolveProjectId('k', 'x')).toBe(5);
});
describe('project parent', () => {
  const child = (parent: any) => ({ id: 13, parent });
  it('strips blocked parent, keeps allowed parent', async () => {
    mockFetch({
      'GET /projects.json': { body: { projects: [child({ id: 12, name: 'Secret' }), { id: 14, parent: { id: 5, name: 'Ok' } }], total_count: 2 } },
      'GET /projects/13.json': { body: { project: child({ id: 12, name: 'Secret' }) } },
      'GET /projects/14.json': { body: { project: { id: 14, parent: { id: 5, name: 'Ok' } } } },
    });
    expect((await gw.listProjects('k', {})).items).toEqual([{ id: 13 }, { id: 14, parent: { id: 5, name: 'Ok' } }]);
    expect(await gw.getProject('k', 13)).toEqual({ id: 13 });
    expect(await gw.getProject('k', 14)).toEqual({ id: 14, parent: { id: 5, name: 'Ok' } });
  });
});
it('times out and aborts fetch => Redmine unavailable', async () => {
  const spy = jest.spyOn(global, 'fetch').mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
  await expect(gw.getProject('k', 'x')).rejects.toThrow('Redmine unavailable');
  expect((spy.mock.calls[0][1] as any).signal).toBeInstanceOf(AbortSignal);
});
it('maps 404', async () => {
  mockFetch({});
  await expect(gw.getProject('k', 'x')).rejects.toThrow('Not found');
});
it('maps 422 errors joined', async () => {
  mockFetch({ 'GET /projects/x.json': { status: 422, body: { errors: ['Subject cannot be blank', 'Tracker is invalid'] } } });
  await expect(gw.getProject('k', 'x')).rejects.toThrow('Subject cannot be blank; Tracker is invalid');
});
it.each([[{ status: 503 }], ['network-error']])('maps %p to Redmine unavailable', async (r) => {
  mockFetch({ 'GET /projects/x.json': r as any });
  await expect(gw.getProject('k', 'x')).rejects.toThrow('Redmine unavailable');
});
it.each([[401, 'Unauthorized'], [403, 'Forbidden']])('maps %i', async (status, msg) => {
  mockFetch({ 'GET /projects/x.json': { status } });
  await expect(gw.getProject('k', 'x')).rejects.toThrow(msg);
});
it('sends Buffer raw as octet-stream and returns undefined on empty body', async () => {
  const m = mockFetch({ 'POST /uploads.json': { status: 204 } });
  const buf = Buffer.from('abc');
  expect(await (gw as any).request('k', 'POST', '/uploads.json', undefined, buf)).toBeUndefined();
  expect(m.calls[0].headers['Content-Type']).toBe('application/octet-stream');
  expect(m.calls[0].body).toBe(buf);
});
it('repeats array query keys', async () => {
  const m = mockFetch({ 'GET /issues.json': { body: {} } });
  await (gw as any).request('k', 'GET', '/issues.json', { 'f[]': ['a', 'b'], x: undefined });
  expect(m.calls[0].url.search).toBe('?f%5B%5D=a&f%5B%5D=b');
});

it('encodes project ref in path', async () => {
  const m = mockFetch({ 'GET /projects/a%2Fb.json': { body: { project: { id: 5 } } } });
  await gw.getProject('k', 'a/b');
  expect(m.calls[0].url.pathname).toBe('/projects/a%2Fb.json');
});
it('passes redirect: error to fetch', async () => {
  const m = mockFetch({ 'GET /projects.json': { body: { projects: [], total_count: 0 } } });
  await gw.listProjects('k', {});
  expect((global.fetch as jest.Mock).mock.calls[0][1].redirect).toBe('error');
  expect(m.calls).toHaveLength(1);
});
it('422 without errors array => Validation failed', async () => {
  mockFetch({ 'GET /projects/x.json': { status: 422, body: {} } });
  await expect(gw.getProject('k', 'x')).rejects.toThrow('Validation failed');
});

describe('issues', () => {
  const p13 = { 'GET /projects/13.json': { body: { project: { id: 13 } } } };
  const i1 = { 'GET /issues/1.json': { body: { issue: { id: 1, project: { id: 13 } } } } };
  const i2 = { 'GET /issues/2.json': { body: { issue: { id: 2, project: { id: 12 } } } } };
  const p12 = { 'GET /projects/12.json': { body: { project: { id: 12 } } } };

  it('listIssues filters items of blocked subproject even with allowed project filter', async () => {
    mockFetch({ ...p13, 'GET /issues.json': { body: { issues: [{ id: 1, project: { id: 13 } }, { id: 2, project: { id: 12 } }], total_count: 2 } } });
    expect((await gw.listIssues('k', { project: 13 })).items.map((i) => i.id)).toEqual([1]);
  });
  it('listIssues on blocked project => Not found, no /issues.json call', async () => {
    const m = mockFetch(p12);
    await expect(gw.listIssues('k', { project: 12 })).rejects.toThrow('Not found');
    expect(m.calls.map((c) => c.url.pathname)).not.toContain('/issues.json');
  });
  it('getIssue requests journals,attachments only and blocks', async () => {
    const m = mockFetch(i2);
    await expect(gw.getIssue('k', 2)).rejects.toThrow('Not found');
    expect(m.calls[0].url.searchParams.get('include')).toBe('journals,attachments');
  });
  it('getIssue returns allowed issue', async () => {
    mockFetch(i1);
    expect(await gw.getIssue('k', 1)).toEqual({ id: 1, project: { id: 13 } });
  });
  it('createIssue in blocked project sends no POST', async () => {
    const m = mockFetch(p12);
    await expect(gw.createIssue('k', { project: 12, subject: 's' })).rejects.toThrow('Not found');
    expect(m.calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('createIssue posts project_id and returns issue', async () => {
    const m = mockFetch({ 'GET /projects/x.json': { body: { project: { id: 13 } } }, 'POST /issues.json': { status: 201, body: { issue: { id: 9 } } } });
    expect(await gw.createIssue('k', { project: 'x', subject: 's' })).toEqual({ id: 9 });
    expect(m.calls[1].body).toEqual({ issue: { subject: 's', project_id: 13 } });
  });
  it('updateIssue moving issue into blocked project sends no PUT', async () => {
    const m = mockFetch({ ...i1, ...p12 });
    await expect(gw.updateIssue('k', 1, { project: 12 })).rejects.toThrow('Not found');
    expect(m.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
  it('updateIssue of blocked issue sends no PUT', async () => {
    const m = mockFetch(i2);
    await expect(gw.updateIssue('k', 2, { subject: 'x' })).rejects.toThrow('Not found');
    expect(m.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
  it('updateIssue sends project_id, never project', async () => {
    const m = mockFetch({ ...i1, ...p13, 'PUT /issues/1.json': { status: 204 } });
    await gw.updateIssue('k', 1, { project: 13, notes: 'n' });
    expect(m.calls[2].body).toEqual({ issue: { notes: 'n', project_id: 13 } });
  });
  it('addIssueComment on blocked issue sends no PUT', async () => {
    const m = mockFetch(i2);
    await expect(gw.addIssueComment('k', 2, 'hi')).rejects.toThrow('Not found');
    expect(m.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
  it('addIssueComment sends { issue: { notes } }', async () => {
    const m = mockFetch({ ...i1, 'PUT /issues/1.json': { status: 204 } });
    await gw.addIssueComment('k', 1, 'hi');
    expect(m.calls[1].body).toEqual({ issue: { notes: 'hi' } });
  });
  it('listIssues subject filter uses f[]/op/v', async () => {
    const m = mockFetch({ 'GET /issues.json': { body: { issues: [], total_count: 0 } } });
    await gw.listIssues('k', { subject: 'abc', status: 'closed' });
    const sp = m.calls[0].url.searchParams;
    expect(sp.getAll('f[]')).toEqual(['subject', 'status_id']);
    expect(sp.get('op[subject]')).toBe('~');
    expect(sp.getAll('v[subject][]')).toEqual(['abc']);
    expect(sp.get('op[status_id]')).toBe('c');
    expect(sp.has('status_id')).toBe(false);
  });
  it('listIssues subject filter with numeric status and assigned_to', async () => {
    const m = mockFetch({ 'GET /issues.json': { body: { issues: [], total_count: 0 } } });
    await gw.listIssues('k', { subject: 'abc', status: '5', assigned_to: 'me' });
    const sp = m.calls[0].url.searchParams;
    expect(sp.getAll('f[]')).toEqual(['subject', 'status_id', 'assigned_to_id']);
    expect(sp.get('op[status_id]')).toBe('=');
    expect(sp.getAll('v[status_id][]')).toEqual(['5']);
    expect(sp.get('op[assigned_to_id]')).toBe('=');
    expect(sp.getAll('v[assigned_to_id][]')).toEqual(['me']);
  });
  it('listIssues subject without status defaults to open', async () => {
    const m = mockFetch({ 'GET /issues.json': { body: { issues: [], total_count: 0 } } });
    await gw.listIssues('k', { subject: 'abc' });
    expect(m.calls[0].url.searchParams.get('op[status_id]')).toBe('o');
  });
  it('listIssues without subject uses shortcuts', async () => {
    const m = mockFetch({ ...p13, 'GET /issues.json': { body: { issues: [], total_count: 0 } } });
    await gw.listIssues('k', { project: 13, status: 'open', assigned_to: 'me' });
    const sp = m.calls[1].url.searchParams;
    expect(sp.get('project_id')).toBe('13');
    expect(sp.get('status_id')).toBe('open');
    expect(sp.get('assigned_to_id')).toBe('me');
    expect(sp.has('f[]')).toBe(false);
  });
  it('listIssues status "constructor" is not treated as a shortcut', async () => {
    const m = mockFetch({ 'GET /issues.json': { body: { issues: [], total_count: 0 } } });
    await gw.listIssues('k', { subject: 'x', status: 'constructor' });
    const sp = m.calls[0].url.searchParams;
    expect(sp.get('op[status_id]')).toBe('=');
    expect(sp.getAll('v[status_id][]')).toEqual(['constructor']);
  });
});

describe('time entries', () => {
  const i1 = { 'GET /issues/1.json': { body: { issue: { id: 1, project: { id: 13 } } } } };
  const i2 = { 'GET /issues/2.json': { body: { issue: { id: 2, project: { id: 12 } } } } };
  const p12 = { 'GET /projects/secret-proj.json': { body: { project: { id: 12 } } } };

  it('listTimeEntries filters blocked entries', async () => {
    const m = mockFetch({ 'GET /time_entries.json': { body: { time_entries: [{ id: 1, project: { id: 12 } }, { id: 2, project: { id: 13 } }], total_count: 2 } } });
    expect((await gw.listTimeEntries('k', { user_id: 'me', from: '2026-01-01', to: '2026-01-31' })).items.map((i) => i.id)).toEqual([2]);
    const sp = m.calls[0].url.searchParams;
    expect([sp.get('user_id'), sp.get('from'), sp.get('to')]).toEqual(['me', '2026-01-01', '2026-01-31']);
  });
  it('listTimeEntries by blocked issue => Not found, no /time_entries.json call', async () => {
    const m = mockFetch(i2);
    await expect(gw.listTimeEntries('k', { issue_id: 2 })).rejects.toThrow('Not found');
    expect(m.calls.map((c) => c.url.pathname)).not.toContain('/time_entries.json');
  });
  it('logTime on blocked issue sends no POST', async () => {
    const m = mockFetch(i2);
    await expect(gw.logTime('k', { issue_id: 2, hours: 1 })).rejects.toThrow('Not found');
    expect(m.calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('logTime on blocked project sends no POST', async () => {
    const m = mockFetch(p12);
    await expect(gw.logTime('k', { project: 'secret-proj', hours: 1 })).rejects.toThrow('Not found');
    expect(m.calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('logTime with allowed issue but blocked project sends no POST', async () => {
    const m = mockFetch({ ...i1, ...p12 });
    await expect(gw.logTime('k', { issue_id: 1, project: 'secret-proj', hours: 1 })).rejects.toThrow('Not found');
    expect(m.calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('listTimeEntries with blocked project => Not found, no /time_entries.json call', async () => {
    const m = mockFetch(p12);
    await expect(gw.listTimeEntries('k', { project: 'secret-proj' })).rejects.toThrow('Not found');
    expect(m.calls.map((c) => c.url.pathname)).not.toContain('/time_entries.json');
  });
  it('logTime requires issue_id or project', async () => {
    await expect(gw.logTime('k', { hours: 1 })).rejects.toThrow('issue_id or project is required');
  });
  it('logTime posts { time_entry: {...} } and returns it', async () => {
    const m = mockFetch({ ...i1, 'POST /time_entries.json': { status: 201, body: { time_entry: { id: 7 } } } });
    expect(await gw.logTime('k', { issue_id: 1, hours: 1.5 })).toEqual({ id: 7 });
    expect(m.calls[1].body).toEqual({ time_entry: { issue_id: 1, hours: 1.5 } });
  });
  it('logTime with project sends project_id', async () => {
    const m = mockFetch({ 'GET /projects/x.json': { body: { project: { id: 13 } } }, 'POST /time_entries.json': { status: 201, body: { time_entry: { id: 8 } } } });
    await gw.logTime('k', { project: 'x', hours: 2 });
    expect(m.calls[1].body).toEqual({ time_entry: { project_id: 13, hours: 2 } });
  });
});

describe('attachments', () => {
  const cfg = parseConfig({ REDMINE_URL: 'https://rm.example.com/', BLOCKED_PROJECT_IDS: '12', MAX_FILE_MB: '1' });
  const g = new RedmineGateway(cfg, new ProjectAccessPolicy(cfg));
  const att = { id: 7, filename: 'a.txt', filesize: 5, content_type: 'text/plain', content_url: 'https://evil.example/x' };
  const issues = {
    'GET /issues/1.json': { body: { issue: { id: 1, project: { id: 13 }, attachments: [att] } } },
    'GET /issues/2.json': { body: { issue: { id: 2, project: { id: 12 }, attachments: [att] } } },
  };
  const file = (filename: string, s: string) => ({ filename, content_base64: Buffer.from(s).toString('base64') });
  const uploads = (m: { calls: any[] }) => m.calls.filter((c) => c.url.pathname === '/uploads.json');

  it('createIssue with file uploads then posts uploads', async () => {
    const m = mockFetch({
      'GET /projects/13.json': { body: { project: { id: 13 } } },
      'POST /uploads.json': { status: 201, body: { upload: { token: 't1' } } },
      'POST /issues.json': { status: 201, body: { issue: { id: 9 } } },
    });
    await g.createIssue('k', { project: 13, subject: 's', attachments: [{ ...file('a.txt', 'hello'), content_type: 'text/plain' }] });
    const up = uploads(m)[0];
    expect(up.url.searchParams.get('filename')).toBe('a.txt');
    expect(Buffer.from(up.body).toString()).toBe('hello');
    expect(m.calls.at(-1)!.body.issue.uploads).toEqual([{ token: 't1', filename: 'a.txt', content_type: 'text/plain' }]);
  });
  it('createIssue without files omits uploads', async () => {
    const m = mockFetch({
      'GET /projects/13.json': { body: { project: { id: 13 } } },
      'POST /issues.json': { status: 201, body: { issue: { id: 9 } } },
    });
    await g.createIssue('k', { project: 13, subject: 's' });
    expect('uploads' in m.calls.at(-1)!.body.issue).toBe(false);
  });
  it('createIssue with file in blocked project sends no upload', async () => {
    const m = mockFetch({ 'GET /projects/12.json': { body: { project: { id: 12 } } } });
    await expect(g.createIssue('k', { project: 12, subject: 's', attachments: [file('a', 'x')] })).rejects.toThrow('Not found');
    expect(uploads(m)).toHaveLength(0);
  });
  it('updateIssue with file on blocked issue sends no upload', async () => {
    const m = mockFetch(issues);
    await expect(g.updateIssue('k', 2, { attachments: [file('a', 'x')] })).rejects.toThrow('Not found');
    expect(uploads(m)).toHaveLength(0);
  });
  it('updateIssue of allowed issue into blocked project with file sends no upload and no PUT', async () => {
    const m = mockFetch({ ...issues, 'GET /projects/12.json': { body: { project: { id: 12 } } } });
    await expect(g.updateIssue('k', 1, { project: 12, attachments: [file('a', 'x')] })).rejects.toThrow('Not found');
    expect(uploads(m)).toHaveLength(0);
    expect(m.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
  it('accepts line-wrapped base64', async () => {
    const m = mockFetch({
      'GET /projects/13.json': { body: { project: { id: 13 } } },
      'POST /uploads.json': { status: 201, body: { upload: { token: 't' } } },
      'POST /issues.json': { status: 201, body: { issue: { id: 9 } } },
    });
    const b64 = Buffer.from('hello world!').toString('base64');
    await g.createIssue('k', { project: 13, subject: 's', attachments: [{ filename: 'a', content_base64: `${b64.slice(0, 8)}
${b64.slice(8)}
` }] });
    expect(Buffer.from(uploads(m)[0].body).toString()).toBe('hello world!');
  });
  it('rejects total size over MAX_FILE_MB before any upload', async () => {
    const big = 'x'.repeat(600 * 1024);
    const m = mockFetch({ 'GET /projects/13.json': { body: { project: { id: 13 } } } });
    await expect(g.createIssue('k', { project: 13, subject: 's', attachments: [file('a', big), file('b', big)] }))
      .rejects.toThrow('File too large (max 1 MB)');
    expect(uploads(m)).toHaveLength(0);
  });
  it('rejects invalid base64 before any upload', async () => {
    const m = mockFetch({ 'GET /projects/13.json': { body: { project: { id: 13 } } } });
    await expect(g.createIssue('k', { project: 13, subject: 's',
      attachments: [file('a.bin', 'ok'), { filename: 'b.bin', content_base64: 'abc$' }] })).rejects.toThrow('Invalid base64 for b.bin');
    expect(uploads(m)).toHaveLength(0);
  });
  it('getAttachment downloads from built URL', async () => {
    const m = mockFetch({ ...issues, 'GET /attachments/download/7': { raw: Buffer.from('hello') } });
    expect(await g.getAttachment('k', 1, 7)).toEqual({ filename: 'a.txt', content_type: 'text/plain', data: Buffer.from('hello') });
    expect(m.calls.every((c) => c.url.host === 'rm.example.com')).toBe(true);
    expect(m.calls.at(-1)!.headers['X-Redmine-API-Key']).toBe('k');
  });
  it('getAttachment defaults missing content_type to application/octet-stream', async () => {
    mockFetch({
      'GET /issues/1.json': { body: { issue: { id: 1, project: { id: 13 }, attachments: [{ id: 7, filename: 'a', filesize: 1 }] } } },
      'GET /attachments/download/7': { raw: Buffer.from('Z') },
    });
    expect((await g.getAttachment('k', 1, 7)).content_type).toBe('application/octet-stream');
  });
  it('getAttachment maps download errors', async () => {
    mockFetch({ ...issues, 'GET /attachments/download/7': { status: 503 } });
    await expect(g.getAttachment('k', 1, 7)).rejects.toThrow('Redmine unavailable');
  });
  it.each([[2, 7], [1, 99]])('getAttachment(issue %p, att %p) => Not found, no download', async (i, a) => {
    const m = mockFetch(issues);
    await expect(g.getAttachment('k', i, a)).rejects.toThrow('Not found');
    expect(m.calls.some((c) => c.url.pathname.startsWith('/attachments'))).toBe(false);
  });
  it('getAttachment over size limit => File too large, no download', async () => {
    const m = mockFetch({ 'GET /issues/1.json': { body: { issue: { id: 1, project: { id: 13 },
      attachments: [{ ...att, filesize: 2 * 1024 * 1024 }] } } } });
    await expect(g.getAttachment('k', 1, 7)).rejects.toThrow('File too large (max 1 MB)');
    expect(m.calls.some((c) => c.url.pathname.startsWith('/attachments'))).toBe(false);
  });
  it.each([[2, 7], [1, 99]])('deleteAttachment(issue %p, att %p) => Not found, no DELETE', async (i, a) => {
    const m = mockFetch(issues);
    await expect(g.deleteAttachment('k', i, a)).rejects.toThrow('Not found');
    expect(m.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
  it('deleteAttachment sends DELETE /attachments/7.json', async () => {
    const m = mockFetch({ ...issues, 'DELETE /attachments/7.json': { status: 204 } });
    await g.deleteAttachment('k', 1, 7);
    expect(m.calls.at(-1)).toMatchObject({ method: 'DELETE' });
    expect(m.calls.at(-1)!.url.pathname).toBe('/attachments/7.json');
  });
});
