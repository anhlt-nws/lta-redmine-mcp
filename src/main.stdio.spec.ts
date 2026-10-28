import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Runs the built binary, so a log line on stdout (which would corrupt the protocol) fails these tests.
const DIST = join(__dirname, '..', 'dist', 'main.js');
const built = existsSync(DIST);
if (!built) console.warn(`${DIST} missing: run npm run build first`);
jest.setTimeout(30000);

// Existing shared servers start via these scripts with an old .env (no MCP_TRANSPORT); they must stay HTTP.
it.each(['start', 'start:prod'])('npm run %s selects HTTP', (script) => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  expect(pkg.scripts[script]).toMatch(/ --http$/);
});

(built ? describe : describe.skip)('stdio binary', () => {
  it('lists 11 tools over stdio', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST],
      env: { REDMINE_URL: 'https://example.invalid', REDMINE_API_KEY: 'k' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 't', version: '0' });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(11);
    } finally {
      await client.close();
    }
  });

  it('exits 1 without key, nothing on stdout', () => {
    const r = spawnSync(process.execPath, [DIST], {
      env: { ...process.env, REDMINE_URL: 'https://example.invalid', REDMINE_API_KEY: '', MCP_TRANSPORT: '' },
      input: '',
    });
    expect(r.status).toBe(1);
    expect(r.stdout.toString()).toBe('');
    expect(r.stderr.toString()).toContain('REDMINE_API_KEY is required in stdio mode');
  });
});
