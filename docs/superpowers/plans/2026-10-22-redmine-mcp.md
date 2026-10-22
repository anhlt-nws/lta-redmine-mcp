# Redmine MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP server NestJS (HTTP, stateless) cho Redmine, mỗi user dùng API key riêng, chặn tuyệt đối các project ID được admin liệt kê.

**Architecture:** `McpController` tạo `McpServer` per-request với key của user; các tool chỉ gọi `RedmineGateway`; gateway là chỗ duy nhất gọi Redmine và áp `ProjectAccessPolicy` trước/sau mỗi lời gọi.

**Tech Stack:** Node ≥ 22, NestJS 11 (Express), TypeScript, `@modelcontextprotocol/sdk` 1.x, `zod` 3.x, Jest + supertest (mặc định của Nest CLI).

**Spec:** `docs/superpowers/specs/2026-10-22-redmine-mcp-design.md`

## Global Constraints

- Env: `REDMINE_URL` (bắt buộc), `BLOCKED_PROJECT_IDS` (có thể rỗng, phân tách bằng dấu phẩy), `PORT` (mặc định `3000`), `MAX_FILE_MB` (mặc định `5`, số dương). Config sai thì process thoát khi khởi động.
- Attachment: file đi qua tham số tool dạng base64; check project **trước** mọi `POST /uploads.json`; tải/xoá bắt buộc có cả `issue_id` và `attachment_id`; URL tải tự dựng `${REDMINE_URL}/attachments/download/{id}`.
- Header auth: `X-Redmine-API-Key`. Không lưu key, không log key.
- Bị chặn ⇒ lỗi với message đúng `Not found` (giống Redmine 404).
- List tool: `limit` mặc định 25, tối đa 100; `offset` mặc định 0; trả `{ items, has_more }`, **không** trả `total_count`.
- Lỗi Redmine 401/403/422 ⇒ chuyển message; mạng/5xx ⇒ `Redmine unavailable`. Tool error dùng `isError: true`.
- Không có: wiki, attachment ngoài issue, upload từ URL, `/search.json`, cache, Docker, `children`/`relations` của issue.
- Load `.env` bằng `node --env-file-if-exists=.env` (Node ≥ 22.9), không thêm `@nestjs/config`.
- Lệch spec §5 có chủ đích: file `*.spec.ts` đặt cạnh source (convention Nest, jest `rootDir: src`), thay vì thư mục `test/`.

## Review Focus

1. `BLOCKED_PROJECT_IDS` có dấu phẩy thừa hoặc khoảng trắng (`"12, 15,"`) ⇒ bỏ qua phần tử rỗng, vẫn khởi động; `"12,abc"` ⇒ không khởi động. Test ở Task 1.
2. Project truyền dạng chuỗi số `"12"` hoặc identifier của project bị chặn ⇒ đều `Not found`. Test ở Task 3.
3. `REDMINE_URL` có dấu `/` cuối ⇒ không sinh URL `//`. Test ở Task 3.
4. Header `X-Redmine-API-Key` rỗng hoặc chỉ có khoảng trắng ⇒ 401 như thiếu header. Test ở Task 7.
5. Redmine 422 với nhiều lỗi ⇒ message ghép `errors` bằng `"; "` để AI tự sửa được. Test ở Task 3.

---

### Task 1: Scaffold + config

**Files:**
- Create (scaffold): toàn bộ project Nest tại thư mục gốc
- Create: `src/config/config.ts`, `src/config/config.module.ts`, `src/config/config.spec.ts`, `.env.example`
- Modify: `package.json` (scripts, `engines`), `src/main.ts`, `src/app.module.ts`; xoá `src/app.controller*.ts`, `src/app.service.ts`, `test/` (e2e mẫu)

**Interfaces:**
- Produces:
  ```ts
  export interface AppConfig { redmineUrl: string; blockedProjectIds: Set<number>; port: number; maxFileMb: number }
  export function parseConfig(env: NodeJS.ProcessEnv): AppConfig // throw Error khi sai
  export const APP_CONFIG = 'APP_CONFIG' // injection token
  ```
  `ConfigModule` (`@Global()`, `src/config/config.module.ts`) cung cấp và export `{ provide: APP_CONFIG, useFactory: () => parseConfig(process.env) }`; `AppModule` import nó. Env chỉ được parse ở đây.

- [ ] **Step 1: Scaffold**

Run: `npx @nestjs/cli@11 new . --package-manager npm --skip-git --strict`
rồi `npm i @modelcontextprotocol/sdk zod@3`. Xoá app controller/service mẫu và thư mục `test/`, bỏ script `test:e2e`. Đặt `"engines": { "node": ">=22.9" }`, script `"start": "node --env-file-if-exists=.env dist/main"`, `"start:dev": "nest start --watch --exec \"node --env-file-if-exists=.env\""`. Thêm `.env` vào `.gitignore`.

- [ ] **Step 2: Viết test fail** (`src/config/config.spec.ts`)

```ts
const base = { REDMINE_URL: 'https://rm.example.com' };
it('parses full config', () => {
  expect(parseConfig({ ...base, BLOCKED_PROJECT_IDS: '12,15,40', PORT: '4000', MAX_FILE_MB: '10' }))
    .toEqual({ redmineUrl: 'https://rm.example.com', blockedProjectIds: new Set([12, 15, 40]), port: 4000, maxFileMb: 10 });
});
it('defaults: empty blocklist, port 3000, 5 MB', () => {
  expect(parseConfig(base)).toEqual({ redmineUrl: 'https://rm.example.com', blockedProjectIds: new Set(), port: 3000, maxFileMb: 5 });
});
it.each(['0', '-1', 'abc'])('rejects MAX_FILE_MB=%s', (v) => {
  expect(() => parseConfig({ ...base, MAX_FILE_MB: v })).toThrow(/MAX_FILE_MB/);
});
it('strips trailing slash of REDMINE_URL', () => {
  expect(parseConfig({ REDMINE_URL: 'https://rm.example.com/' }).redmineUrl).toBe('https://rm.example.com');
});
it('ignores blanks and spaces', () => {
  expect(parseConfig({ ...base, BLOCKED_PROJECT_IDS: ' 12, 15 ,' }).blockedProjectIds).toEqual(new Set([12, 15]));
});
it.each(['12,abc', '0', '-3', '1.5'])('rejects BLOCKED_PROJECT_IDS=%s', (v) => {
  expect(() => parseConfig({ ...base, BLOCKED_PROJECT_IDS: v })).toThrow(/BLOCKED_PROJECT_IDS/);
});
it('requires REDMINE_URL', () => {
  expect(() => parseConfig({})).toThrow(/REDMINE_URL/);
});
```

- [ ] **Step 3: Chạy, thấy fail**

Run: `npx jest src/config` — Expected: FAIL (`parseConfig` chưa tồn tại).

- [ ] **Step 4: Implement `parseConfig` trong `src/config/config.ts`**; tạo `ConfigModule` global, import vào `AppModule`; `main.ts` lấy `app.get<AppConfig>(APP_CONFIG).port` để `listen`. Giá trị hợp lệ: `/^\d+$/` và `> 0`. `REDMINE_URL` phải parse được bằng `new URL()`. Tạo `.env.example` với 4 biến của Global Constraints.

- [ ] **Step 5: Chạy test + build**

Run: `npx jest src/config && npm run build` — Expected: PASS, build không lỗi.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold NestJS app with env config"
```

---

### Task 2: ProjectAccessPolicy

**Files:**
- Create: `src/redmine/project-access.policy.ts`, `src/redmine/project-access.policy.spec.ts`, `src/redmine/redmine.errors.ts`

**Interfaces:**
- Consumes: `APP_CONFIG`, `AppConfig` (Task 1)
- Produces:
  ```ts
  export class RedmineError extends Error {}               // message hiển thị cho AI
  export const notFound = () => new RedmineError('Not found');
  @Injectable() export class ProjectAccessPolicy {
    constructor(@Inject(APP_CONFIG) config: AppConfig)
    isBlocked(projectId: number): boolean
    assertAllowed(projectId: number): void                 // throw notFound()
    filter<T extends { project: { id: number } }>(items: T[]): T[]
  }
  ```

- [ ] **Step 1: Viết test fail**

```ts
const policy = new ProjectAccessPolicy({ redmineUrl: 'x', port: 1, blockedProjectIds: new Set([12]) });
it('isBlocked', () => { expect(policy.isBlocked(12)).toBe(true); expect(policy.isBlocked(13)).toBe(false); });
it('assertAllowed throws Not found', () => {
  expect(() => policy.assertAllowed(12)).toThrow(new RedmineError('Not found'));
  expect(() => policy.assertAllowed(13)).not.toThrow();
});
it('filter drops blocked items', () => {
  expect(policy.filter([{ id: 1, project: { id: 12 } }, { id: 2, project: { id: 13 } }]).map(i => i.id)).toEqual([2]);
});
```

- [ ] **Step 2: Chạy, thấy fail** — `npx jest src/redmine/project-access` — FAIL.
- [ ] **Step 3: Implement** theo Interfaces.
- [ ] **Step 4: Chạy, thấy pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: add project access policy"`

---

### Task 3: RedmineGateway — HTTP core + projects

**Files:**
- Create: `src/redmine/redmine.gateway.ts`, `src/redmine/redmine.gateway.spec.ts`, `src/redmine/fetch-mock.ts`, `src/redmine/redmine.module.ts`

**Interfaces:**
- Consumes: `AppConfig`, `ProjectAccessPolicy`, `RedmineError`, `notFound`
- Produces:
  ```ts
  export type ProjectRef = number | string;                 // id hoặc identifier
  export interface PageArgs { limit?: number; offset?: number }
  export interface Page<T> { items: T[]; has_more: boolean }
  export class RedmineGateway {
    constructor(@Inject(APP_CONFIG) config: AppConfig, policy: ProjectAccessPolicy)
    listProjects(apiKey: string, page: PageArgs): Promise<Page<any>>
    getProject(apiKey: string, ref: ProjectRef): Promise<any> // đã check policy
    resolveProjectId(apiKey: string, ref: ProjectRef): Promise<number> // GET /projects/{ref}.json + assertAllowed
    private request(apiKey: string, method: 'GET'|'POST'|'PUT'|'DELETE', path: string,
                    query?: Record<string, string | number | string[] | undefined>, body?: unknown): Promise<any>
                    // body là Buffer ⇒ gửi nguyên, Content-Type application/octet-stream; còn lại ⇒ JSON
    private page(apiKey: string, path: string, key: string, query: Record<string, ...>, page: PageArgs,
                 projectIdOf: (item: any) => number = (i) => i.project.id): Promise<Page<any>> // dùng lại ở Task 4, 5
                 // listProjects truyền (p) => p.id
  }
  // fetch-mock.ts (chỉ dùng trong test)
  export function mockFetch(routes: Record<string, { status?: number; body?: unknown } | 'network-error'>):
    { calls: { method: string; url: URL; body?: any }[] }
  // key route = `${METHOD} ${pathname}`, vd 'GET /projects/12.json'; route không khai báo ⇒ 404
  ```
  `RedmineModule` provide + export `RedmineGateway`, `ProjectAccessPolicy`; `APP_CONFIG` đến từ `ConfigModule` global (Task 1).

`request`: URL = `config.redmineUrl + path`, header `X-Redmine-API-Key` + `Content-Type: application/json`; mảng trong query ⇒ lặp key (cho `f[]`, `v[subject][]`). Map lỗi: 404 ⇒ `notFound()`; 401/403 ⇒ `RedmineError('Unauthorized'|'Forbidden')`; 422 ⇒ `RedmineError(errors.join('; '))`; ≥500 hoặc fetch throw ⇒ `RedmineError('Redmine unavailable')`; body rỗng (201/204 không body) ⇒ `undefined`.
`page`: `limit` clamp `[1,100]` mặc định 25, `offset` mặc định 0; trả `{ items: json[key].filter(i => !policy.isBlocked(projectIdOf(i))), has_more: offset + limit < json.total_count }`.

- [ ] **Step 1: Viết test fail** (`blocked = {12}`, `REDMINE_URL='https://rm.example.com/'` đi qua `parseConfig`)

```ts
it('sends api key header, no double slash', async () => {
  const m = mockFetch({ 'GET /projects.json': { body: { projects: [], total_count: 0 } } });
  await gw.listProjects('k', {});
  expect(m.calls[0].url.href).toBe('https://rm.example.com/projects.json?limit=25&offset=0');
  // assert header X-Redmine-API-Key === 'k' (lưu header trong calls)
});
it('listProjects filters blocked, has_more from total_count', async () => {
  mockFetch({ 'GET /projects.json': { body: { projects: [{ id: 12 }, { id: 13 }], total_count: 30 } } });
  expect(await gw.listProjects('k', { limit: 2 })).toEqual({ items: [{ id: 13 }], has_more: true });
});
it.each(['12', 12, 'secret-proj'])('getProject(%p) on blocked project ⇒ Not found', async (ref) => {
  mockFetch({ [`GET /projects/${ref}.json`]: { body: { project: { id: 12, identifier: 'secret-proj' } } } });
  await expect(gw.getProject('k', ref)).rejects.toThrow(new RedmineError('Not found'));
});
it('maps 422 errors joined', async () => {
  mockFetch({ 'GET /projects/x.json': { status: 422, body: { errors: ['Subject cannot be blank', 'Tracker is invalid'] } } });
  await expect(gw.getProject('k', 'x')).rejects.toThrow('Subject cannot be blank; Tracker is invalid');
});
it.each([[{ status: 503 }], ['network-error']])('maps %p to Redmine unavailable', async (r) => {
  mockFetch({ 'GET /projects/x.json': r as any });
  await expect(gw.getProject('k', 'x')).rejects.toThrow('Redmine unavailable');
});
it('maps 401', async () => { /* status 401 ⇒ 'Unauthorized' */ });
```

- [ ] **Step 2: Chạy, thấy fail** — `npx jest src/redmine/redmine.gateway`
- [ ] **Step 3: Implement** `mockFetch`, `request`, `page`, `listProjects`, `getProject`, `resolveProjectId`, `RedmineModule`.
- [ ] **Step 4: Chạy, thấy pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: add redmine gateway core and project reads"`

---

### Task 4: RedmineGateway — issues

**Files:**
- Modify: `src/redmine/redmine.gateway.ts`, `src/redmine/redmine.gateway.spec.ts`

**Interfaces:**
- Consumes: `request`, `page`, `resolveProjectId` (Task 3)
- Produces:
  ```ts
  export interface ListIssuesArgs extends PageArgs { project?: ProjectRef; status?: string; assigned_to?: string; subject?: string }
  export interface CreateIssueArgs { project: ProjectRef; subject: string; description?: string; tracker_id?: number;
    status_id?: number; priority_id?: number; assigned_to_id?: number }
  export interface UpdateIssueArgs { project?: ProjectRef; subject?: string; description?: string; status_id?: number;
    priority_id?: number; assigned_to_id?: number; done_ratio?: number; notes?: string }
  listIssues(apiKey, args: ListIssuesArgs): Promise<Page<any>>
  getIssue(apiKey, id: number): Promise<any>          // include=journals,attachments, check project
  createIssue(apiKey, args: CreateIssueArgs): Promise<any> // trả issue mới
  updateIssue(apiKey, id: number, args: UpdateIssueArgs): Promise<void>
  addIssueComment(apiKey, id: number, notes: string): Promise<void>
  ```
  Query `listIssues` luôn có `project_id` (ID số đã resolve) nếu có project. Còn lại:
  - **Không có `subject`:** shortcut params `status_id` (=`status`: `open|closed|*|<id>`), `assigned_to_id` (=`assigned_to`: `me|<id>`).
  - **Có `subject`:** Redmine bỏ qua shortcut khi có `f[]`, nên mọi filter đi qua `f[]`:
    `f[]=subject, op[subject]=~, v[subject][]=<text>`;
    status: `open`/không truyền ⇒ `op[status_id]=o`, `closed` ⇒ `c`, `*` ⇒ `*`, số ⇒ `=` + `v[status_id][]=<id>` (luôn có `f[]=status_id`);
    assigned_to (nếu có) ⇒ `f[]=assigned_to_id, op[assigned_to_id]==, v[assigned_to_id][]=<me|id>`.
  Xác nhận trên Redmine thật ở smoke test (Task 7).
  `createIssue`/`updateIssue` gửi `{ issue: { ..., project_id } }` với `project_id` từ `resolveProjectId`.

- [ ] **Step 1: Viết test fail** (`blocked = {12}`; issue 1 thuộc project 13, issue 2 thuộc project 12)

```ts
it('listIssues filters items of blocked subproject even with allowed project filter', async () => {
  mockFetch({ 'GET /projects/13.json': { body: { project: { id: 13 } } },
    'GET /issues.json': { body: { issues: [{ id: 1, project: { id: 13 } }, { id: 2, project: { id: 12 } }], total_count: 2 } } });
  expect((await gw.listIssues('k', { project: 13 })).items.map(i => i.id)).toEqual([1]);
});
it('listIssues on blocked project ⇒ Not found, no /issues.json call', async () => {
  const m = mockFetch({ 'GET /projects/12.json': { body: { project: { id: 12 } } } });
  await expect(gw.listIssues('k', { project: 12 })).rejects.toThrow('Not found');
  expect(m.calls.map(c => c.url.pathname)).not.toContain('/issues.json');
});
it('getIssue requests journals,attachments only and blocks', async () => {
  const m = mockFetch({ 'GET /issues/2.json': { body: { issue: { id: 2, project: { id: 12 } } } } });
  await expect(gw.getIssue('k', 2)).rejects.toThrow('Not found');
  expect(m.calls[0].url.searchParams.get('include')).toBe('journals,attachments');
});
it('createIssue in blocked project sends no POST', async () => { /* project 12 ⇒ Not found; calls không có method POST */ });
it('updateIssue moving issue into blocked project sends no PUT', async () => {
  const m = mockFetch({ 'GET /issues/1.json': { body: { issue: { id: 1, project: { id: 13 } } } },
                        'GET /projects/12.json': { body: { project: { id: 12 } } } });
  await expect(gw.updateIssue('k', 1, { project: 12 })).rejects.toThrow('Not found');
  expect(m.calls.some(c => c.method === 'PUT')).toBe(false);
});
it('updateIssue of blocked issue sends no PUT', async () => { /* issue 2 ⇒ Not found, không PUT */ });
it('addIssueComment on blocked issue sends no PUT', async () => { /* issue 2 ⇒ Not found, không PUT */ });
it('addIssueComment sends { issue: { notes } }', async () => { /* issue 1, PUT 204; body === { issue: { notes: 'hi' } } */ });
it('listIssues subject filter uses f[]/op/v', async () => {
  /* { subject: 'abc', status: 'closed' } ⇒ getAll('f[]') === ['subject','status_id']; op[subject] '~'; v[subject][] 'abc'; op[status_id] 'c'; không có param status_id */
});
it('listIssues without subject uses shortcuts', async () => { /* { status: 'open', assigned_to: 'me' } ⇒ status_id 'open', assigned_to_id 'me', không có f[] */ });
```

- [ ] **Step 2: Chạy, thấy fail.**
- [ ] **Step 3: Implement** 5 method theo Interfaces.
- [ ] **Step 4: Chạy, thấy pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: add issue operations to gateway"`

---

### Task 5: RedmineGateway — time entries

**Files:**
- Modify: `src/redmine/redmine.gateway.ts`, `src/redmine/redmine.gateway.spec.ts`

**Interfaces:**
- Consumes: `request`, `page`, `resolveProjectId`, `getIssue` (Task 3–4)
- Produces:
  ```ts
  export interface ListTimeEntriesArgs extends PageArgs { project?: ProjectRef; issue_id?: number; user_id?: string; from?: string; to?: string }
  export interface LogTimeArgs { issue_id?: number; project?: ProjectRef; hours: number; spent_on?: string; activity_id?: number; comments?: string }
  listTimeEntries(apiKey, args: ListTimeEntriesArgs): Promise<Page<any>>
  logTime(apiKey, args: LogTimeArgs): Promise<any>   // trả time entry mới
  ```
  `issue_id` ⇒ `getIssue` trước (check); `project` ⇒ `resolveProjectId`. `logTime` thiếu cả hai ⇒ `RedmineError('issue_id or project is required')`. Query: `project_id`, `issue_id`, `user_id`, `from`, `to`.

- [ ] **Step 1: Viết test fail**

```ts
it('listTimeEntries filters blocked entries', async () => { /* entries project 12 & 13 ⇒ chỉ còn 13 */ });
it('listTimeEntries by blocked issue ⇒ Not found, no /time_entries.json call', async () => { /* issue 2 */ });
it('logTime on blocked issue sends no POST', async () => { /* issue 2 ⇒ Not found */ });
it('logTime on blocked project sends no POST', async () => { /* project 'secret-proj' → id 12 ⇒ Not found */ });
it('logTime requires issue_id or project', async () => {
  await expect(gw.logTime('k', { hours: 1 })).rejects.toThrow('issue_id or project is required');
});
it('logTime posts { time_entry: {...} }', async () => { /* issue 1 ⇒ POST body.time_entry.issue_id === 1, hours === 1.5 */ });
```

- [ ] **Step 2: Chạy, thấy fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Chạy, thấy pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: add time entry operations to gateway"`

---

### Task 6: RedmineGateway — attachments

**Files:**
- Modify: `src/redmine/redmine.gateway.ts`, `src/redmine/redmine.gateway.spec.ts`, `src/redmine/fetch-mock.ts` (route trả body binary: `{ status?, raw: Buffer, contentType? }`)

**Interfaces:**
- Consumes: `request`, `getIssue`, `createIssue`, `updateIssue`, `AppConfig.maxFileMb` (Task 1–5)
- Produces:
  ```ts
  export interface FileInput { filename: string; content_base64: string; content_type?: string; description?: string }
  // CreateIssueArgs, UpdateIssueArgs thêm: attachments?: FileInput[]
  export interface DownloadedFile { filename: string; content_type: string; data: Buffer }
  getAttachment(apiKey: string, issueId: number, attachmentId: number): Promise<DownloadedFile>
  deleteAttachment(apiKey: string, issueId: number, attachmentId: number): Promise<void>
  private uploadFiles(apiKey: string, files: FileInput[] | undefined): Promise<object[] | undefined>
  // trả mảng { token, filename, content_type, description } cho field `uploads` của issue
  ```
  `createIssue`/`updateIssue`: check project như cũ ⇒ `uploadFiles` ⇒ gửi issue kèm `uploads` (bỏ field khi không có file).
  `uploadFiles`: validate **tất cả** file trước khi upload file đầu tiên. Base64 hợp lệ khi khớp `/^[A-Za-z0-9+/]*={0,2}$/` và độ dài chia hết cho 4; sai ⇒ `RedmineError('Invalid base64 for <filename>')`. Tổng `Buffer.byteLength` > `maxFileMb * 1024 * 1024` ⇒ `RedmineError('File too large (max <N> MB)')`. Sau đó mỗi file `POST /uploads.json?filename=<filename>` với body Buffer ⇒ `upload.token`.
  `getAttachment`/`deleteAttachment`: `getIssue` (check project) ⇒ tìm `attachmentId` trong `issue.attachments ?? []`, không có ⇒ `notFound()`. Get: `filesize` > giới hạn ⇒ `File too large (max <N> MB)`; tải `GET ${redmineUrl}/attachments/download/{id}` với header key, map lỗi như `request`, trả `{ filename, content_type, data }` từ metadata của attachment. Delete: `DELETE /attachments/{id}.json`.

- [ ] **Step 1: Viết test fail** (`maxFileMb = 1`; issue 1 thuộc project 13 có attachment `{ id: 7, filename: 'a.txt', filesize: 5, content_type: 'text/plain' }`; issue 2 thuộc project 12)

```ts
it('createIssue with file uploads then posts uploads', async () => {
  const m = mockFetch({ 'GET /projects/13.json': { body: { project: { id: 13 } } },
    'POST /uploads.json': { status: 201, body: { upload: { token: 't1' } } },
    'POST /issues.json': { status: 201, body: { issue: { id: 9 } } } });
  await gw.createIssue('k', { project: 13, subject: 's',
    attachments: [{ filename: 'a.txt', content_base64: Buffer.from('hello').toString('base64'), content_type: 'text/plain' }] });
  const up = m.calls.find(c => c.url.pathname === '/uploads.json')!;
  expect(up.url.searchParams.get('filename')).toBe('a.txt');
  expect(Buffer.from(up.body).toString()).toBe('hello');
  expect(m.calls.at(-1)!.body.issue.uploads).toEqual([{ token: 't1', filename: 'a.txt', content_type: 'text/plain' }]);
});
it('createIssue with file in blocked project sends no upload', async () => { /* project 12 ⇒ Not found; không call /uploads.json */ });
it('updateIssue with file on blocked issue sends no upload', async () => { /* issue 2 ⇒ Not found; không call /uploads.json */ });
it('rejects total size over MAX_FILE_MB before any upload', async () => {
  /* 2 file mỗi file 600 KB ⇒ 'File too large (max 1 MB)'; không call /uploads.json */
});
it('rejects invalid base64 before any upload', async () => {
  /* file 1 hợp lệ, file 2 content_base64 'abc$' ⇒ 'Invalid base64 for b.bin'; không call /uploads.json */
});
it('getAttachment downloads from built URL', async () => {
  const m = mockFetch({ 'GET /issues/1.json': { body: { issue: { id: 1, project: { id: 13 },
      attachments: [{ id: 7, filename: 'a.txt', filesize: 5, content_type: 'text/plain', content_url: 'https://evil.example/x' }] } } },
    'GET /attachments/download/7': { raw: Buffer.from('hello') } });
  const f = await gw.getAttachment('k', 1, 7);
  expect(f).toEqual({ filename: 'a.txt', content_type: 'text/plain', data: Buffer.from('hello') });
  expect(m.calls.every(c => c.url.host === 'rm.example.com')).toBe(true);
});
it.each([[2, 7], [1, 99]])('getAttachment(issue %p, att %p) ⇒ Not found, no download', async (issue, att) => { /* không call /attachments/download */ });
it('getAttachment over size limit ⇒ File too large, no download', async () => { /* filesize 2 MB */ });
it.each([[2, 7], [1, 99]])('deleteAttachment(issue %p, att %p) ⇒ Not found, no DELETE', async () => {});
it('deleteAttachment sends DELETE /attachments/7.json', async () => {});
```

- [ ] **Step 2: Chạy, thấy fail.**
- [ ] **Step 3: Implement** theo Interfaces.
- [ ] **Step 4: Chạy, thấy pass** (cả test Task 4 cũ của `createIssue`/`updateIssue`).
- [ ] **Step 5: Commit** — `git commit -m "feat: add issue attachments to gateway"`

---

### Task 7: MCP tools + controller

**Files:**
- Create: `src/mcp/mcp.controller.ts`, `src/mcp/mcp.controller.spec.ts`, `src/mcp/mcp.module.ts`, `src/mcp/tools/result.ts`, `src/mcp/tools/projects.tools.ts`, `src/mcp/tools/issues.tools.ts`, `src/mcp/tools/time-entries.tools.ts`, `src/mcp/tools/attachments.tools.ts`
- Modify: `src/app.module.ts` (import `McpModule`), `src/main.ts` (body limit)

**Interfaces:**
- Consumes: toàn bộ method public của `RedmineGateway` (Task 3–6), `RedmineError`, `AppConfig.maxFileMb`
- Produces:
  ```ts
  // result.ts
  export async function toolResult(fn: () => Promise<unknown>): Promise<CallToolResult>
  // ok ⇒ { content: [{ type: 'text', text: JSON.stringify(value ?? { ok: true }, null, 2) }] }
  // RedmineError ⇒ { isError: true, content: [{ type: 'text', text: err.message }] }; lỗi khác ⇒ rethrow
  // *.tools.ts
  export function registerProjectTools(server: McpServer, gw: RedmineGateway, apiKey: string): void
  export function registerIssueTools(server: McpServer, gw: RedmineGateway, apiKey: string): void
  export function registerTimeEntryTools(server: McpServer, gw: RedmineGateway, apiKey: string): void
  export function registerAttachmentTools(server: McpServer, gw: RedmineGateway, apiKey: string): void
  export function fileContent(f: DownloadedFile): CallToolResult['content'][number]
  // text/*, application/json, application/xml ⇒ { type: 'text', text: utf8 }
  // image/* ⇒ { type: 'image', data: base64, mimeType }
  // khác ⇒ { type: 'text', text: JSON.stringify({ filename, content_type, content_base64 }) }
  ```
  Tên tool (đúng spec §3, 11 tool): `list_projects`, `get_project`, `list_issues`, `get_issue`, `create_issue`, `update_issue`, `add_issue_comment`, `list_time_entries`, `log_time`, `get_attachment`, `delete_attachment`. `create_issue`/`update_issue` có `attachments: z.array(z.object({ filename, content_base64, content_type?, description? })).optional()`; `get_attachment`/`delete_attachment` có `issue_id`, `attachment_id` (`z.number().int()`, bắt buộc). `get_attachment` trả `{ content: [fileContent(f)] }` (bọc trong try/catch `RedmineError` giống `toolResult`).
  Body limit: `NestFactory.create(AppModule, { bodyParser: false })` rồi `app.useBodyParser('json', { limit: \`${Math.ceil(maxFileMb * 4 / 3) + 1}mb\` })`. Dùng `server.registerTool(name, { description, inputSchema: { ...zod shape } }, handler)`; field zod khớp `*Args` ở Task 4–5; `project` là `z.union([z.number().int(), z.string()])`; `limit` `z.number().int().min(1).max(100).optional()`.
  Controller: `@Post('mcp')` lấy header `x-redmine-api-key`, `trim()`, rỗng ⇒ 401 `{ error: 'Missing X-Redmine-API-Key' }`. Ngược lại: `new McpServer({ name: 'redmine', version: '0.1.0' })`, đăng ký 4 nhóm tool, `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`, `await server.connect(transport)`, `await transport.handleRequest(req, res, req.body)`, đóng cả hai khi `res.on('close')`. `@Get('mcp')`/`@Delete('mcp')` ⇒ 405.

- [ ] **Step 1: Viết test fail** (`mcp.controller.spec.ts`, Nest testing module + supertest, `RedmineGateway` mock)

```ts
it.each([undefined, '', '   '])('401 when api key header is %p', async (key) => {
  const r = request(app.getHttpServer()).post('/mcp').send({});
  if (key !== undefined) r.set('X-Redmine-API-Key', key);
  await r.expect(401);
});
it('tools/list returns all 11 tools', async () => {
  const res = await request(app.getHttpServer()).post('/mcp')
    .set('X-Redmine-API-Key', 'k').set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  // parse body (JSON hoặc SSE 'data:' line) ⇒ tên tool sắp xếp === 11 tên ở Interfaces
});
it.each([
  ['text/plain', 'hello', { type: 'text', text: 'hello' }],
  ['image/png', 'PNG', { type: 'image', data: Buffer.from('PNG').toString('base64'), mimeType: 'image/png' }],
  ['application/zip', 'Z', { type: 'text', text: JSON.stringify({ filename: 'f', content_type: 'application/zip', content_base64: 'Wg==' }) }],
])('fileContent(%s)', (ct, data, expected) => {
  expect(fileContent({ filename: 'f', content_type: ct, data: Buffer.from(data) })).toEqual(expected);
});
it('accepts a 2 MB JSON body (body limit raised)', async () => {
  // app tạo giống main.ts (bodyParser false + useBodyParser); POST /mcp với create_issue có content_base64 ~2 MB ⇒ không trả 413
});
it('RedmineError becomes isError tool result', async () => {
  // gw.getIssue mock reject new RedmineError('Not found'); tools/call get_issue {id: 2}
  // ⇒ result.isError === true, content[0].text === 'Not found'
});
```

- [ ] **Step 2: Chạy, thấy fail.**
- [ ] **Step 3: Implement** `toolResult`, `fileContent`, 4 file tool, controller, `McpModule`, body limit trong `main.ts` (tách hàm `configureApp(app, config)` để test dùng chung).
- [ ] **Step 4: Chạy toàn bộ test + build** — `npm test && npm run build` — PASS.
- [ ] **Step 5: Smoke test thủ công với Redmine thật**

Tạo `.env` (REDMINE_URL thật, `BLOCKED_PROJECT_IDS` = ID một project bạn có quyền xem), `npm run build && npm start`, rồi `npx @modelcontextprotocol/inspector` ⇒ transport Streamable HTTP, URL `http://localhost:3000/mcp`, header `X-Redmine-API-Key`. Kiểm tra: `list_projects` không có project bị chặn; `get_project` project bị chặn ⇒ `Not found`; `list_issues` với `subject` trả kết quả đúng (xác nhận cú pháp `f[]` ở Task 4); `create_issue` kèm 1 file nhỏ ⇒ file hiện trên Redmine; `get_attachment` file text và ảnh; `delete_attachment` chạy được trên phiên bản Redmine đang dùng.

- [ ] **Step 6: Commit** — `git commit -m "feat: expose redmine tools over MCP streamable HTTP"`
