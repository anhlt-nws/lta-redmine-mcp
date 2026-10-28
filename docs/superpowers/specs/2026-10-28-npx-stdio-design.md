# Chạy qua npx + transport stdio — Design

Ngày: 2026-10-28. Bổ sung cho `2026-10-22-redmine-mcp-design.md` (spec gốc vẫn ràng buộc, trừ chỗ ghi khác dưới đây).

## 1. Mục tiêu

Mỗi user tự chạy MCP trên máy mình bằng `npx -y lta-redmine-mcp`, Claude Desktop/Code nói chuyện qua stdio. Chế độ HTTP dùng chung hiện tại vẫn giữ nguyên.

### Tiêu chí thành công
- Config client chỉ cần `"command": "npx", "args": ["-y", "lta-redmine-mcp"]` + `env` (`REDMINE_URL`, `REDMINE_API_KEY`) là dùng được 11 tool.
- `npx lta-redmine-mcp --http` (hoặc `MCP_TRANSPORT=http`) chạy y như `npm start` hiện nay.
- Ở chế độ stdio, stdout chỉ chứa message JSON-RPC; mọi log đi ra stderr.
- Gateway và logic chặn project không đổi một dòng nào.

### Quyết định đã chốt
- Phát hành lên **npm public**, tên package `lta-redmine-mcp`, license MIT.
- **Mặc định là stdio**; HTTP bật bằng `--http` hoặc `MCP_TRANSPORT=http`.
- Stdio dùng lại Nest (`createApplicationContext`, không có Express) để có cùng `RedmineGateway` qua DI.

### Không làm (YAGNI)
Flag CLI ngoài `--http`, tự load `.env` ở chế độ stdio, Docker, tự động `npm publish` (user tự chạy).

## 2. Hạn chế bảo mật của chế độ stdio

Ở stdio, user tự đặt env nên có thể để trống `BLOCKED_PROJECT_IDS`. Khi đó danh sách chặn chỉ là **tiện ích cục bộ, không phải biện pháp bảo mật**; quyền thật vẫn do Redmine quyết định theo key của user. Muốn chặn có hiệu lực thì phải dùng server HTTP dùng chung do admin cấu hình. README và §7 của spec gốc phải ghi rõ điều này.

## 3. Kiến trúc

```
npx lta-redmine-mcp ──► dist/main.js (#!/usr/bin/env node)
                          │ parseConfig(env, argv) → transport
             ┌────────────┴─────────────┐
           stdio                       http
  createApplicationContext        NestFactory.create (như cũ)
  logger: ['error'] (stderr)      McpController (POST /mcp)
             │                          │
             └── createMcpServer(gw, apiKey) ──┘
                          │
                    RedmineGateway (không đổi)
```

| Unit | Thay đổi |
|---|---|
| `config/config.ts` | `parseConfig(env, argv = [])` thêm `transport: 'stdio' \| 'http'` và `apiKey?: string`. `transport = 'http'` nếu argv có `--http` hoặc `MCP_TRANSPORT=http`; `MCP_TRANSPORT` khác `stdio`/`http` ⇒ lỗi. Stdio mà thiếu `REDMINE_API_KEY` ⇒ lỗi `REDMINE_API_KEY is required in stdio mode`. `PORT` chỉ validate khi http. |
| `mcp/mcp.server.ts` (mới) | `createMcpServer(gw, apiKey): McpServer` — vòng lặp đăng ký 4 nhóm tool, chuyển nguyên từ `McpController`. |
| `mcp/mcp.controller.ts` | Gọi `createMcpServer` thay cho vòng lặp; hành vi không đổi. |
| `main.ts` | Shebang. Đọc config; stdio ⇒ `createApplicationContext(AppModule, { logger: ['error'] })`, lấy `RedmineGateway`, `createMcpServer(gw, config.apiKey).connect(new StdioServerTransport())`; http ⇒ bootstrap như cũ. Config sai ⇒ in message ra stderr, `exit(1)`. |

`AppModule` được dùng cho cả hai mode; `createApplicationContext` không khởi tạo controller HTTP nên không cần module riêng.

Ở stdio, key được đọc từ `config.apiKey`, không bao giờ log ra.

## 4. Đóng gói

`package.json`:
- Bỏ `private`; `license: "MIT"`, thêm file `LICENSE`; điền `description`.
- `bin: { "lta-redmine-mcp": "dist/main.js" }`, `files: ["dist"]`.
- `prepublishOnly: "npm run build && npm test"`.
- `dependencies` giữ nguyên (đã đủ cho runtime); `engines.node >= 22.9` giữ nguyên.

Phải kiểm tra `dist/` không chứa `*.spec.js` hay `fetch-mock.js` (dùng `npm pack --dry-run`).

## 5. Testing

- `config.spec.ts`: mặc định stdio; `--http` và `MCP_TRANSPORT=http` ⇒ http; `MCP_TRANSPORT=foo` ⇒ lỗi; stdio thiếu key ⇒ lỗi; http không cần key; `PORT` sai chỉ lỗi ở http.
- `mcp.server.spec.ts`: `createMcpServer` đăng ký đủ 11 tool (qua client in-memory của SDK).
- `mcp.controller.spec.ts`: giữ nguyên, phải pass.
- E2E stdio (`src/main.stdio.spec.ts`): chạy `node dist/main.js` bằng `StdioClientTransport` của SDK (env có `REDMINE_URL` giả + key giả), `listTools()` trả 11 tool. Cần `npm run build` trước; test tự skip kèm message nếu chưa có `dist/main.js`. Vì `StdioClientTransport` parse stdout, một dòng log lọt ra stdout sẽ làm test fail.
- Thủ công: `npm pack` → `npx ./lta-redmine-mcp-<ver>.tgz` với Inspector (stdio) trên Redmine thật.

## 6. Tài liệu

- README: phần config client stdio (npx) đặt trước, HTTP sau; bảng env thêm `REDMINE_API_KEY`, `MCP_TRANSPORT`; ghi hạn chế ở §2.
- Spec gốc: §1 "Transport" ghi thêm stdio; §7 thêm hạn chế ở §2.
- CLAUDE.md: thêm lệnh chạy stdio và ghi chú "stdout của stdio chỉ dành cho protocol".
