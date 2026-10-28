export interface AppConfig {
  redmineUrl: string;
  blockedProjectIds: Set<number>;
  // Resolved to ids at runtime (RedmineGateway), since only Redmine knows the mapping.
  blockedIdentifiers: Set<string>;
  port: number;
  maxFileMb: number;
  transport: 'stdio' | 'http';
  // stdio only: one user per process, so the key comes from env instead of a request header.
  apiKey?: string;
}

const TRANSPORTS = ['stdio', 'http'] as const;

export const APP_CONFIG = 'APP_CONFIG';

const posInt = (s: string) => /^\d+$/.test(s) && Number(s) > 0;

export function parseConfig(env: NodeJS.ProcessEnv, argv: string[] = []): AppConfig {
  const url = env.REDMINE_URL?.trim();
  if (!url) throw new Error('REDMINE_URL is required');
  try {
    new URL(url);
  } catch {
    throw new Error(`REDMINE_URL is not a valid URL: ${url}`);
  }

  const blockedProjectIds = new Set<number>();
  const blockedIdentifiers = new Set<string>();
  for (const part of (env.BLOCKED_PROJECT_IDS ?? '').split(',')) {
    const s = part.trim();
    if (!s) continue;
    if (posInt(s)) blockedProjectIds.add(Number(s));
    else if (/^[a-z][a-z0-9_-]*$/.test(s)) blockedIdentifiers.add(s);
    else throw new Error(`BLOCKED_PROJECT_IDS has invalid id or identifier: "${s}"`);
  }

  const transportRaw = env.MCP_TRANSPORT?.trim().toLowerCase() || 'stdio';
  if (!(TRANSPORTS as readonly string[]).includes(transportRaw)) {
    throw new Error(`MCP_TRANSPORT must be stdio or http: "${transportRaw}"`);
  }
  const transport = argv.includes('--http') ? 'http' : (transportRaw as AppConfig['transport']);

  let apiKey: string | undefined;
  if (transport === 'stdio') {
    apiKey = env.REDMINE_API_KEY?.trim();
    if (!apiKey) throw new Error('REDMINE_API_KEY is required in stdio mode');
  }

  const portRaw = (transport === 'http' && env.PORT?.trim()) || '3000';
  if (!posInt(portRaw)) throw new Error(`PORT must be a positive integer: "${portRaw}"`);

  const mbRaw = env.MAX_FILE_MB?.trim() || '5';
  const maxFileMb = Number(mbRaw);
  if (!/^\d+(\.\d+)?$/.test(mbRaw) || !(maxFileMb > 0)) {
    throw new Error(`MAX_FILE_MB must be a positive number: "${mbRaw}"`);
  }

  return {
    redmineUrl: url.replace(/\/+$/, ''),
    blockedProjectIds,
    blockedIdentifiers,
    port: Number(portRaw),
    maxFileMb,
    transport,
    apiKey,
  };
}
