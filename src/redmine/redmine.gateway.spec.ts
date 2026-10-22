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
it('getProject returns allowed project; resolveProjectId returns id', async () => {
  mockFetch({ 'GET /projects/x.json': { body: { project: { id: 5 } } } });
  expect(await gw.getProject('k', 'x')).toEqual({ id: 5 });
  expect(await gw.resolveProjectId('k', 'x')).toBe(5);
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
});
