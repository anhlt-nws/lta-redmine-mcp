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
- Danh sách chặn: do admin cấu hình qua env, áp dụng cho mọi user, chứa **project ID số và/hoặc identifier** (vd `12,nws-sale`). Identifier được đổi sang ID lúc chạy (§3.2).
- **Không chặn đệ quy**: chỉ chặn đúng các ID được liệt kê; admin tự thêm project con nếu cần.
- Phạm vi tool: đọc + ghi cơ bản, kèm attachment của issue (upload khi tạo/sửa, xem, tải, xoá).
- File đi qua tham số tool dạng base64 (không tải từ URL, tránh SSRF); giới hạn `MAX_FILE_MB`.

### Không làm (YAGNI)
Wiki, attachment của wiki/document/project, upload từ URL, `/search.json`, cache, rate limit, Docker, audit log, cấu hình chặn riêng cho từng user.

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
| `list_projects` | `GET /projects.json`, lọc bỏ ID bị chặn; xoá field `parent` của project nếu nó trỏ tới project bị chặn |
| `get_project` | resolve, check, trả project (xoá `parent` nếu trỏ tới project bị chặn) |
| `list_issues` (filter: project, status, assignee, subject) | nếu có project thì resolve và check; `GET /issues.json`; lọc theo `issue.project.id` |
| `get_issue` | `GET /issues/{id}.json?include=journals,attachments`; check `issue.project.id`. Không include `children`/`relations` vì chứa subject của issue khác mà không kèm project |
| `list_time_entries` (filter: project, issue, user, from, to) | nếu có project thì resolve và check; nếu có issue thì `GET` issue và check; `GET /time_entries.json`; lọc theo `entry.project.id` |
| `create_issue` | resolve và check project đích; upload attachment (§3.1); `POST /issues.json` |
| `update_issue` | `GET` issue và check project hiện tại; nếu payload đổi `project_id` thì resolve và check project mới; upload attachment (§3.1); `PUT /issues/{id}.json` |
| `add_issue_comment` | `GET` issue và check; `PUT /issues/{id}.json` với `notes` |
| `log_time` | phải có `issue_id` hoặc `project_id`: có issue thì `GET` issue và check; có project thì resolve và check; `POST /time_entries.json` |
| `get_attachment` (`issue_id`, `attachment_id`) | §3.1 |
| `delete_attachment` (`issue_id`, `attachment_id`) | §3.1 |

### 3.1 Attachment

**Upload** — `create_issue`/`update_issue` nhận thêm:
```ts
attachments?: { filename: string; content_base64: string; content_type?: string; description?: string }[]
```
1. Check project (như bảng trên) **trước** khi upload; bị chặn thì không gửi byte nào lên Redmine.
2. Decode base64; sai định dạng ⇒ lỗi `Invalid base64 for <filename>`; **tổng** dung lượng đã decode của mọi file trong một lần gọi > `MAX_FILE_MB` ⇒ lỗi `File too large (max <N> MB)`.
3. Mỗi file: `POST /uploads.json?filename=<filename>` (`Content-Type: application/octet-stream`, body binary) ⇒ `upload.token`.
4. Gửi issue kèm `uploads: [{ token, filename, content_type, description }]`.

Body limit của Express (mặc định 100 KB) phải nâng lên đủ chứa base64 của `MAX_FILE_MB` (`ceil(MAX_FILE_MB * 4/3) + 1` MB).

**Xem** — `get_issue` trả `attachments[]` (`id, filename, filesize, content_type, description, author, created_on`).

**Tải / xoá** — JSON attachment của Redmine không cho biết project chứa nó, nên tool bắt buộc có cả `issue_id` và `attachment_id`:
1. `GET` issue với `include=attachments`, check project.
2. `attachment_id` không thuộc `issue.attachments` ⇒ `Not found`.
3. `get_attachment`: `filesize` > `MAX_FILE_MB` ⇒ lỗi `File too large (max <N> MB)`; tải từ `${REDMINE_URL}/attachments/download/{id}` (tự dựng URL, không dùng `content_url` để key không đi sang host khác). Kết quả:
   - `text/*`, `application/json`, `application/xml`: MCP text content.
   - Chỉ `image/png`, `image/jpeg`, `image/gif`, `image/webp`: MCP image content (base64 + mimeType). Các `image/*` khác (svg, bmp, tiff...) rơi vào nhánh JSON bên dưới.
   - Khác: text content là JSON `{ filename, content_type, content_base64 }`.
4. `delete_attachment`: `DELETE /attachments/{id}.json` (xác nhận phiên bản Redmine hỗ trợ khi smoke test).

### Phân trang
List tool nhận `limit` (mặc định 25, tối đa 100) và `offset`, trả `{ items, has_more }` với `has_more = offset + limit < total_count` của Redmine. Không trả `total_count` vì con số này có tính cả item bị chặn. Do lọc sau khi lấy về, một trang có thể trả ít hơn `limit`.

### Lỗi
- Bị chặn, hoặc Redmine 404: `Not found`.
- Redmine 401/403/422: chuyển nguyên message (gồm `errors[]` của 422) thành tool error (`isError: true`).
- Lỗi mạng hoặc 5xx: tool error `Redmine unavailable`.

### 3.2 Identifier trong danh sách chặn

Mỗi method public của gateway, trước mọi việc khác, đổi các identifier chưa có ID bằng `GET /projects/{identifier}.json` với **key của user** (song song):
- Thành công ⇒ ID được thêm vào tập chặn và cache cho mọi user (identifier trong Redmine không đổi được).
- 404/403 ⇒ user này không xem được project đó nên cũng không đọc được dữ liệu của nó; bỏ qua, **không cache kết quả âm**, thử lại ở lần gọi sau.
- Lỗi khác (5xx, mạng, 401) ⇒ request lỗi luôn (fail closed), không gửi request lấy dữ liệu nào.

Lời gọi nội bộ giữa các method dùng helper private nên mỗi lần gọi tool chỉ đổi đúng một lần.

## 4. Cấu hình

```
REDMINE_URL=https://redmine.example.com   # bắt buộc
BLOCKED_PROJECT_IDS=12,nws-sale           # có thể rỗng; mỗi phần tử là ID số dương hoặc identifier
                                          # (chữ thường/số/-/_, bắt đầu bằng chữ); sai định dạng thì không khởi động
PORT=3000                                  # mặc định 3000
MAX_FILE_MB=5                              # mặc định 5; giới hạn tổng upload mỗi lần gọi và mỗi file tải về
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
  mcp/tools/attachments.tools.ts
test/
  project-access.policy.spec.ts
  redmine.gateway.spec.ts
  mcp.controller.spec.ts
```

## 6. Testing (Jest)

- **Policy và config**: `isBlocked`, parse `BLOCKED_PROJECT_IDS` (rỗng, khoảng trắng, ID lẫn identifier, giá trị sai định dạng).
- **Identifier** (§3.2): đổi sang ID rồi chặn; chỉ đổi một lần; 404/403 thì vẫn chạy và thử lại; 5xx thì lỗi, không gửi request dữ liệu; mọi method public đổi đúng một lần.
- **Gateway** (mock `fetch`), mỗi tool ít nhất một case chặn:
  - đọc 1 resource của project bị chặn thì trả `Not found`
  - list chứa item bị chặn thì item đó bị lọc
  - list theo project cha được phép mà có item của project con bị chặn thì item đó vẫn bị lọc
  - `update_issue` chuyển issue sang project bị chặn thì bị từ chối, không có `PUT` nào được gửi
  - `log_time` / `add_issue_comment` vào issue thuộc project bị chặn thì bị từ chối, không có request ghi nào được gửi
  - `create_issue` kèm file vào project bị chặn: không có `POST /uploads.json` nào
  - `get_attachment` / `delete_attachment`: issue bị chặn, hoặc attachment không thuộc issue ⇒ `Not found`, không tải/xoá
  - vượt `MAX_FILE_MB` (upload tổng, download theo `filesize`) và base64 sai ⇒ lỗi, không upload
- **Controller**: thiếu header `X-Redmine-API-Key` thì trả 401.
- Không có e2e với Redmine thật; smoke test thủ công bằng MCP Inspector.

## 7. Hạn chế đã biết
- Text tự do (description, journal notes) nhắc tới project bị chặn thì không lọc được.
- Journal `details` có thể chứa ID số của project cũ hoặc mới khi issue từng được chuyển project.
- `parent` của issue chỉ chứa ID nên không lộ nội dung, nhưng lộ việc issue cha tồn tại.
- `fixed_version` của issue được phép có thể là version được share từ project bị chặn (lộ tên version).
- Với user không phải member, Redmine trả 403 cho project private bị chặn nhưng 404 cho project không tồn tại ⇒ lộ sự tồn tại (không lộ dữ liệu); server giữ nguyên 403 để lỗi quyền thật vẫn rõ ràng.
- Gõ sai identifier trong `BLOCKED_PROJECT_IDS` không bị phát hiện (Redmine trả 404 giống như khi user không có quyền). Kiểm tra sau khi cấu hình: `get_project` với identifier đó phải trả `Not found` với một user xem được project.
- User không xem được một project bị chặn khai báo bằng identifier sẽ tốn thêm 1 request nhỏ cho mỗi identifier như vậy ở mỗi lần gọi tool (không cache kết quả âm).
- File đi qua context của AI dưới dạng base64 nên tốn token; chỉ hợp file nhỏ.
- Nếu upload được vài file rồi lỗi ở file sau hoặc ở bước tạo/sửa issue, các file đã upload bị bỏ lại ở trạng thái chưa gắn vào issue nào; admin dọn bằng `rake redmine:attachments:prune`.
