import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { ProjectAccessPolicy } from './project-access.policy';
import { RedmineError, notFound } from './redmine.errors';

export type ProjectRef = number | string;
export interface PageArgs { limit?: number; offset?: number }
export interface Page<T> { items: T[]; has_more: boolean }
export interface ListIssuesArgs extends PageArgs { project?: ProjectRef; status?: string; assigned_to?: string; subject?: string }
export interface CreateIssueArgs { project: ProjectRef; subject: string; description?: string; tracker_id?: number;
  status_id?: number; priority_id?: number; assigned_to_id?: number; attachments?: FileInput[] }
export interface UpdateIssueArgs { project?: ProjectRef; subject?: string; description?: string; status_id?: number;
  priority_id?: number; assigned_to_id?: number; done_ratio?: number; notes?: string; attachments?: FileInput[] }
export interface FileInput { filename: string; content_base64: string; content_type?: string; description?: string }
export interface DownloadedFile { filename: string; content_type: string; data: Buffer }
export interface ListTimeEntriesArgs extends PageArgs { project?: ProjectRef; issue_id?: number; user_id?: string; from?: string; to?: string }
export interface LogTimeArgs { issue_id?: number; project?: ProjectRef; hours: number; spent_on?: string; activity_id?: number; comments?: string }
type Query = Record<string, string | number | string[] | undefined>;

@Injectable()
export class RedmineGateway {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly policy: ProjectAccessPolicy,
  ) {}

  async listProjects(apiKey: string, page: PageArgs): Promise<Page<any>> {
    const res = await this.page(apiKey, '/projects.json', 'projects', {}, page, (p) => p.id);
    return { ...res, items: res.items.map((p) => this.stripBlockedParent(p)) };
  }

  // A child's `parent` would leak the name of a blocked parent project.
  private stripBlockedParent(project: any): any {
    if (project.parent && this.policy.isBlocked(project.parent.id)) {
      const { parent, ...rest } = project;
      return rest;
    }
    return project;
  }

  async getProject(apiKey: string, ref: ProjectRef): Promise<any> {
    const { project } = await this.request(apiKey, 'GET', `/projects/${encodeURIComponent(String(ref))}.json`);
    this.policy.assertAllowed(project.id);
    return this.stripBlockedParent(project);
  }

  async resolveProjectId(apiKey: string, ref: ProjectRef): Promise<number> {
    return (await this.getProject(apiKey, ref)).id;
  }

  async listIssues(apiKey: string, args: ListIssuesArgs): Promise<Page<any>> {
    const query: Query = {};
    if (args.project !== undefined) query.project_id = String(await this.resolveProjectId(apiKey, args.project));
    if (args.subject === undefined) {
      query.status_id = args.status;
      query.assigned_to_id = args.assigned_to;
    } else {
      // Redmine ignores shortcut params once f[] is present, so everything goes through f[].
      const status = args.status ?? 'open';
      const f = ['subject', 'status_id'];
      query['op[subject]'] = '~';
      query['v[subject][]'] = [args.subject];
      const ops: Record<string, string> = { open: 'o', closed: 'c', '*': '*' };
      query['op[status_id]'] = Object.hasOwn(ops, status) ? ops[status] : '=';
      if (!['open', 'closed', '*'].includes(status)) query['v[status_id][]'] = [status];
      if (args.assigned_to !== undefined) {
        f.push('assigned_to_id');
        query['op[assigned_to_id]'] = '=';
        query['v[assigned_to_id][]'] = [args.assigned_to];
      }
      query['f[]'] = f;
    }
    return this.page(apiKey, '/issues.json', 'issues', query, args);
  }

  async getIssue(apiKey: string, id: number): Promise<any> {
    const { issue } = await this.request(apiKey, 'GET', `/issues/${id}.json`, { include: 'journals,attachments' });
    this.policy.assertAllowed(issue.project.id);
    return issue;
  }

  async createIssue(apiKey: string, args: CreateIssueArgs): Promise<any> {
    const { project, attachments, ...fields } = args;
    const project_id = await this.resolveProjectId(apiKey, project);
    const uploads = await this.uploadFiles(apiKey, attachments);
    return (await this.request(apiKey, 'POST', '/issues.json', undefined, { issue: { ...fields, project_id, uploads } })).issue;
  }

  async updateIssue(apiKey: string, id: number, args: UpdateIssueArgs): Promise<void> {
    await this.getIssue(apiKey, id);
    const { project, attachments, ...fields } = args;
    const project_id = project === undefined ? undefined : await this.resolveProjectId(apiKey, project);
    const uploads = await this.uploadFiles(apiKey, attachments);
    await this.request(apiKey, 'PUT', `/issues/${id}.json`, undefined, { issue: { ...fields, project_id, uploads } });
  }

  async getAttachment(apiKey: string, issueId: number, attachmentId: number): Promise<DownloadedFile> {
    const att = await this.findAttachment(apiKey, issueId, attachmentId);
    if (att.filesize > this.maxBytes) throw this.tooLarge();
    const res = await this.send(apiKey, 'GET', new URL(`${this.config.redmineUrl}/attachments/download/${attachmentId}`));
    if (!res.ok) throw new RedmineError(`Redmine error ${res.status}`);
    return { filename: att.filename, content_type: att.content_type ?? 'application/octet-stream', data: Buffer.from(await res.arrayBuffer()) };
  }

  async deleteAttachment(apiKey: string, issueId: number, attachmentId: number): Promise<void> {
    await this.findAttachment(apiKey, issueId, attachmentId);
    await this.request(apiKey, 'DELETE', `/attachments/${attachmentId}.json`);
  }

  private get maxBytes(): number { return this.config.maxFileMb * 1024 * 1024; }
  private tooLarge(): RedmineError { return new RedmineError(`File too large (max ${this.config.maxFileMb} MB)`); }

  private async findAttachment(apiKey: string, issueId: number, attachmentId: number): Promise<any> {
    const att = ((await this.getIssue(apiKey, issueId)).attachments ?? []).find((a: any) => a.id === attachmentId);
    if (!att) throw notFound();
    return att;
  }

  private async uploadFiles(apiKey: string, files: FileInput[] | undefined): Promise<object[] | undefined> {
    if (!files?.length) return undefined;
    let total = 0;
    const buffers = files.map((f) => {
      const b64 = f.content_base64.replace(/\s/g, '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) {
        throw new RedmineError(`Invalid base64 for ${f.filename}`);
      }
      const buf = Buffer.from(b64, 'base64');
      total += buf.byteLength;
      return buf;
    });
    if (total > this.maxBytes) throw this.tooLarge();
    const result: object[] = [];
    for (const [i, f] of files.entries()) {
      const { upload } = await this.request(apiKey, 'POST', '/uploads.json', { filename: f.filename }, buffers[i]);
      result.push({ token: upload.token, filename: f.filename, content_type: f.content_type, description: f.description });
    }
    return result;
  }

  async addIssueComment(apiKey: string, id: number, notes: string): Promise<void> {
    await this.updateIssue(apiKey, id, { notes });
  }

  async listTimeEntries(apiKey: string, args: ListTimeEntriesArgs): Promise<Page<any>> {
    const { project, limit, offset, ...filters } = args;
    if (args.issue_id !== undefined) await this.getIssue(apiKey, args.issue_id);
    const query: Query = { ...filters };
    if (project !== undefined) query.project_id = await this.resolveProjectId(apiKey, project);
    return this.page(apiKey, '/time_entries.json', 'time_entries', query, { limit, offset });
  }

  async logTime(apiKey: string, args: LogTimeArgs): Promise<any> {
    const { project, ...fields } = args;
    if (args.issue_id === undefined && project === undefined) throw new RedmineError('issue_id or project is required');
    if (args.issue_id !== undefined) await this.getIssue(apiKey, args.issue_id);
    const project_id = project === undefined ? undefined : await this.resolveProjectId(apiKey, project);
    return (await this.request(apiKey, 'POST', '/time_entries.json', undefined, { time_entry: { ...fields, project_id } })).time_entry;
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
    const res = await this.send(apiKey, method, url, body);
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (res.status === 422) throw new RedmineError(Array.isArray(json?.errors) ? json.errors.join('; ') : 'Validation failed');
    if (!res.ok) throw new RedmineError(`Redmine error ${res.status}`);
    return json;
  }

  // Fetch with the shared headers/redirect policy and status->error mapping; callers handle the rest.
  private async send(apiKey: string, method: string, url: URL, body?: unknown): Promise<Response> {
    const raw = Buffer.isBuffer(body);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
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
    return res;
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
