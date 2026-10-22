# lta-redmine-mcp

NestJS MCP server for Redmine. Exposes 11 tools (projects, issues, time entries, attachments) over stateless
Streamable HTTP at `POST /mcp`. Each request is authenticated with the caller's own `X-Redmine-API-Key` header;
projects listed in `BLOCKED_PROJECT_IDS` are hidden from every tool.

## Environment

| Var | Default | Meaning |
|-----|---------|---------|
| `REDMINE_URL` | required | Redmine base URL |
| `BLOCKED_PROJECT_IDS` | empty | Comma-separated project ids and/or identifiers to hide, e.g. `12,nws-sale`. Not recursive: list subprojects too. A mistyped identifier is not detected — check that `get_project` on it returns `Not found`. |
| `PORT` | `3000` | HTTP port |
| `MAX_FILE_MB` | `5` | Max attachment size (upload and download) |

## Run

```bash
npm install
npm run build
REDMINE_URL=https://redmine.example.com npm start
```

## Client config

```json
{ "mcpServers": { "redmine": {
    "type": "http", "url": "http://mcp-host:3000/mcp",
    "headers": { "X-Redmine-API-Key": "<your key>" } } } }
```
