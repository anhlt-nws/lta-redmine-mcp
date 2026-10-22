# Redmine MCP Server (NestJS) — Design

Ngày: 2026-10-22

## 1. Mục tiêu

MCP server cho Redmine, viết bằng NestJS, deploy dùng chung cho team qua HTTP. Mỗi user kết nối bằng API key Redmine của riêng mình. Admin cấu hình danh sách project bị chặn: MCP **không được đọc hay ghi** bất kỳ dữ liệu nào thuộc các project đó (mục đích bảo mật).

### Tiêu chí thành công
- User dùng Claude (Code/Desktop) đọc và thao tác issue, time entry qua MCP bằng key của mình.
- Không tool nào trả về dữ liệu, hay cho phép ghi, vào project có ID nằm trong `BLOCKED_PROJECT_IDS`.
- Project bị chặn không phân biệt được với project không tồn tại (cùng thông báo `Not found`).

### Quyết định đã chốt
- Transport: Streamable HTTP, stateless, SDK chính thức `@modelcontextprotocol/sdk`.
- Auth: header `X-Redmine-API-Key` của từng user; server không lưu key và không log key.
- Danh sách chặn: do admin cấu hình qua env, áp dụng cho mọi user, chỉ chứa **project ID số**.
- **Không chặn đệ quy**: chỉ chặn đúng các ID được liệt kê; admin tự thêm project con nếu cần.
- Phạm vi tool: đọc + ghi cơ bản.

### Không làm (YAGNI)
Wiki, attachment, `/search.json`, cache, rate limit, Docker, audit log, cấu hình chặn riêng cho từng user.

## 2. Kiến trúc

```
MCP client ──HTTP POST /mcp (header X-Redmine-API-Key)──► McpController
                                                          │ tạo McpServer per-request (stateless)
                                                          ▼
                                                    Tools (projects / issues / time-entries)
                                                          │
                                                          ▼
                                       RedmineGateway ◄── ProjectAccessPolicy (BLOCKED_PROJECT_IDS)
                                                          │ fetch + apiKey của user
                                                          ▼
                                                       Redmine REST API
```

| Unit | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `config/config.ts` | Đọc và validate `REDMINE_URL`, `BLOCKED_PROJECT_IDS`, `PORT`. Thiếu hoặc sai thì không khởi động. | env |
| `ProjectAccessPolicy` | `isBlocked(id)`, `assertAllowed(id)`, `filter(items, getProjectId)`. Logic thuần, không I/O. | config |
| `RedmineGateway` | Toàn bộ HTTP tới Redmine (`fetch` có sẵn trong Node). Mỗi method nhận `apiKey` và tự áp policy. **Chỗ duy nhất gọi Redmine.** | policy |
| `mcp/tools/*.tools.ts` | Định nghĩa tool (tên, schema zod, mô tả), gọi gateway. Không chứa logic chặn. | gateway |
| `McpController` | `POST /mcp`: thiếu header thì trả 401; tạo `McpServer` + `StreamableHTTPServerTransport` (stateless), đăng ký tool với key của user. | SDK |

## 3. Tools và luồng chặn

### Quy tắc chung
- Tham số project nhận ID hoặc `identifier`. Gateway resolve bằng `GET /projects/{x}.json` (key của user), lấy ID số, rồi gọi `assertAllowed(id)`.
- Khi bị chặn, ném lỗi với message `Not found`, giống hệt khi Redmine trả 404.
- **Luôn lọc lại kết quả list**, kể cả khi đã truyền `project_id`, vì Redmine mặc định trả cả dữ liệu của project con.

| Tool | Luồng |
|---|---|
| `list_projects` | `GET /projects.json`, lọc bỏ ID bị chặn |
| `get_project` | resolve, check, trả project |
| `list_issues` (filter: project, status, assignee, subject) | nếu có project thì resolve và check; `GET /issues.json`; lọc theo `issue.project.id` |
| `get_issue` | `GET /issues/{id}.json?include=journals`; check `issue.project.id`. Không include `children`/`relations` vì chứa subject của issue khác mà không kèm project |
| `list_time_entries` (filter: project, issue, user, from, to) | nếu có project thì resolve và check; nếu có issue thì `GET` issue và check; `GET /time_entries.json`; lọc theo `entry.project.id` |
| `create_issue` | resolve và check project đích, rồi `POST /issues.json` |
| `update_issue` | `GET` issue và check project hiện tại; nếu payload đổi `project_id` thì resolve và check project mới; `PUT /issues/{id}.json` |
| `add_issue_comment` | `GET` issue và check; `PUT /issues/{id}.json` với `notes` |
| `log_time` | phải có `issue_id` hoặc `project_id`: có issue thì `GET` issue và check; có project thì resolve và check; `POST /time_entries.json` |

### Phân trang
List tool nhận `limit` (mặc định 25, tối đa 100) và `offset`, trả `{ items, has_more }` với `has_more = offset + limit < total_count` của Redmine. Không trả `total_count` vì con số này có tính cả item bị chặn. Do lọc sau khi lấy về, một trang có thể trả ít hơn `limit`.

### Lỗi
- Bị chặn, hoặc Redmine 404: `Not found`.
- Redmine 401/403/422: chuyển nguyên message (gồm `errors[]` của 422) thành tool error (`isError: true`).
- Lỗi mạng hoặc 5xx: tool error `Redmine unavailable`.

## 4. Cấu hình

```
REDMINE_URL=https://redmine.example.com   # bắt buộc
BLOCKED_PROJECT_IDS=12,15,40              # có thể rỗng; phần tử không phải số nguyên dương thì không khởi động
PORT=3000                                  # mặc định 3000
```

Config phía client:
```json
{ "mcpServers": { "redmine": {
    "type": "http", "url": "http://mcp-host:3000/mcp",
    "headers": { "X-Redmine-API-Key": "<key của bạn>" } } } }
```

## 5. Cấu trúc thư mục

```
src/
  main.ts
  app.module.ts
  config/config.ts
  redmine/project-access.policy.ts
  redmine/redmine.gateway.ts
  mcp/mcp.controller.ts
  mcp/tools/projects.tools.ts
  mcp/tools/issues.tools.ts
  mcp/tools/time-entries.tools.ts
test/
  project-access.policy.spec.ts
  redmine.gateway.spec.ts
  mcp.controller.spec.ts
```

## 6. Testing (Jest)

- **Policy và config**: `isBlocked`, parse `BLOCKED_PROJECT_IDS` (rỗng, khoảng trắng, giá trị không phải số).
- **Gateway** (mock `fetch`), mỗi tool ít nhất một case chặn:
  - đọc 1 resource của project bị chặn thì trả `Not found`
  - list chứa item bị chặn thì item đó bị lọc
  - list theo project cha được phép mà có item của project con bị chặn thì item đó vẫn bị lọc
  - `update_issue` chuyển issue sang project bị chặn thì bị từ chối, không có `PUT` nào được gửi
  - `log_time` / `add_issue_comment` vào issue thuộc project bị chặn thì bị từ chối, không có request ghi nào được gửi
- **Controller**: thiếu header `X-Redmine-API-Key` thì trả 401.
- Không có e2e với Redmine thật; smoke test thủ công bằng MCP Inspector.

## 7. Hạn chế đã biết
- Text tự do (description, journal notes) nhắc tới project bị chặn thì không lọc được.
- Journal `details` có thể chứa ID số của project cũ hoặc mới khi issue từng được chuyển project.
- `parent` của issue chỉ chứa ID nên không lộ nội dung, nhưng lộ việc issue cha tồn tại.
