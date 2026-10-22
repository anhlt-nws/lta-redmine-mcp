import { parseConfig } from './config';

const base = { REDMINE_URL: 'https://rm.example.com' };
it('parses full config', () => {
  expect(parseConfig({ ...base, BLOCKED_PROJECT_IDS: '12,15,40', PORT: '4000', MAX_FILE_MB: '10' }))
    .toEqual({ redmineUrl: 'https://rm.example.com', blockedProjectIds: new Set([12, 15, 40]), blockedIdentifiers: new Set(),
      port: 4000, maxFileMb: 10 });
});
it('defaults: empty blocklist, port 3000, 5 MB', () => {
  expect(parseConfig(base)).toEqual({ redmineUrl: 'https://rm.example.com', blockedProjectIds: new Set(), blockedIdentifiers: new Set(),
    port: 3000, maxFileMb: 5 });
});
it.each(['0', '-1', 'abc'])('rejects MAX_FILE_MB=%s', (v) => {
  expect(() => parseConfig({ ...base, MAX_FILE_MB: v })).toThrow(/MAX_FILE_MB/);
});
it('accepts fractional MAX_FILE_MB', () => {
  expect(parseConfig({ ...base, MAX_FILE_MB: '2.5' }).maxFileMb).toBe(2.5);
});
it('strips trailing slash of REDMINE_URL', () => {
  expect(parseConfig({ REDMINE_URL: 'https://rm.example.com/' }).redmineUrl).toBe('https://rm.example.com');
});
it('ignores blanks and spaces', () => {
  expect(parseConfig({ ...base, BLOCKED_PROJECT_IDS: ' 12, 15 ,' }).blockedProjectIds).toEqual(new Set([12, 15]));
});
it('accepts project identifiers mixed with ids', () => {
  const c = parseConfig({ ...base, BLOCKED_PROJECT_IDS: '12, nws-sale,nws_sale-en2' });
  expect(c.blockedProjectIds).toEqual(new Set([12]));
  expect(c.blockedIdentifiers).toEqual(new Set(['nws-sale', 'nws_sale-en2']));
});
it.each(['12,Nws-Sale', 'nws sale', 'a.b', '-x', '0', '-3', '1.5'])('rejects BLOCKED_PROJECT_IDS=%s', (v) => {
  expect(() => parseConfig({ ...base, BLOCKED_PROJECT_IDS: v })).toThrow(/BLOCKED_PROJECT_IDS/);
});
it('requires REDMINE_URL', () => {
  expect(() => parseConfig({})).toThrow(/REDMINE_URL/);
});
it('rejects invalid REDMINE_URL', () => {
  expect(() => parseConfig({ REDMINE_URL: 'not a url' })).toThrow(/REDMINE_URL/);
});
