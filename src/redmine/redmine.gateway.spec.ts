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
