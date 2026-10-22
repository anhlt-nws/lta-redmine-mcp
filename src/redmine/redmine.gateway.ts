import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { ProjectAccessPolicy } from './project-access.policy';
import { RedmineError, notFound } from './redmine.errors';

export type ProjectRef = number | string;
export interface PageArgs { limit?: number; offset?: number }
export interface Page<T> { items: T[]; has_more: boolean }
type Query = Record<string, string | number | string[] | undefined>;

@Injectable()
export class RedmineGateway {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly policy: ProjectAccessPolicy,
  ) {}

  listProjects(apiKey: string, page: PageArgs): Promise<Page<any>> {
    return this.page(apiKey, '/projects.json', 'projects', {}, page, (p) => p.id);
  }

  async getProject(apiKey: string, ref: ProjectRef): Promise<any> {
    const { project } = await this.request(apiKey, 'GET', `/projects/${ref}.json`);
    this.policy.assertAllowed(project.id);
    return project;
  }

  async resolveProjectId(apiKey: string, ref: ProjectRef): Promise<number> {
    return (await this.getProject(apiKey, ref)).id;
  }

  private async request(
    apiKey: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    query?: Query,
    body?: unknown,
  ): Promise<any> {
    const url = new URL(this.config.redmineUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item));
    }
    const raw = Buffer.isBuffer(body);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'X-Redmine-API-Key': apiKey,
          'Content-Type': raw ? 'application/octet-stream' : 'application/json',
        },
        body: body === undefined ? undefined : raw ? (body as unknown as BodyInit) : JSON.stringify(body),
      });
    } catch {
      throw new RedmineError('Redmine unavailable');
    }
    if (res.status === 404) throw notFound();
    if (res.status === 401) throw new RedmineError('Unauthorized');
    if (res.status === 403) throw new RedmineError('Forbidden');
    if (res.status >= 500) throw new RedmineError('Redmine unavailable');
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (res.status === 422) throw new RedmineError((json?.errors ?? []).join('; '));
    if (!res.ok) throw new RedmineError(`Redmine error ${res.status}`);
    return json;
  }

  private async page(
    apiKey: string,
    path: string,
    key: string,
    query: Query,
    page: PageArgs,
    projectIdOf: (item: any) => number = (i) => i.project.id,
  ): Promise<Page<any>> {
    const limit = Math.min(100, Math.max(1, page.limit ?? 25));
    const offset = page.offset ?? 0;
    const json = await this.request(apiKey, 'GET', path, { ...query, limit, offset });
    return {
      items: json[key].filter((i: any) => !this.policy.isBlocked(projectIdOf(i))),
      has_more: offset + limit < json.total_count,
    };
  }
}
