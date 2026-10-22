export interface AppConfig {
  redmineUrl: string;
  blockedProjectIds: Set<number>;
  port: number;
  maxFileMb: number;
}

export const APP_CONFIG = 'APP_CONFIG';

const posInt = (s: string) => /^\d+$/.test(s) && Number(s) > 0;

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const url = env.REDMINE_URL?.trim();
  if (!url) throw new Error('REDMINE_URL is required');
  try {
    new URL(url);
  } catch {
    throw new Error(`REDMINE_URL is not a valid URL: ${url}`);
  }

  const blockedProjectIds = new Set<number>();
  for (const part of (env.BLOCKED_PROJECT_IDS ?? '').split(',')) {
    const s = part.trim();
    if (!s) continue;
    if (!posInt(s)) throw new Error(`BLOCKED_PROJECT_IDS has invalid id: "${s}"`);
    blockedProjectIds.add(Number(s));
  }

  const portRaw = env.PORT?.trim() || '3000';
  if (!posInt(portRaw)) throw new Error(`PORT must be a positive integer: "${portRaw}"`);

  const mbRaw = env.MAX_FILE_MB?.trim() || '5';
  const maxFileMb = Number(mbRaw);
  if (!/^\d+(\.\d+)?$/.test(mbRaw) || !(maxFileMb > 0)) {
    throw new Error(`MAX_FILE_MB must be a positive number: "${mbRaw}"`);
  }

  return {
    redmineUrl: url.replace(/\/+$/, ''),
    blockedProjectIds,
    port: Number(portRaw),
    maxFileMb,
  };
}
