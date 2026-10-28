# lta-redmine-mcp

MCP server for Redmine. Exposes 11 tools (projects, issues, time entries, attachments). Two ways to run it:

- **stdio (default)** — each user runs it locally via `npx`, with their own `REDMINE_API_KEY`.
- **HTTP** (`--http`) — one shared server, stateless Streamable HTTP at `POST /mcp`; each request is authenticated
  with the caller's own `X-Redmine-API-Key` header.

Projects listed in `BLOCKED_PROJECT_IDS` are hidden from every tool. **This is only a security control in HTTP mode**,
where an admin sets it. In stdio mode the user sets their own env, so the list is a local convenience; what they can
reach is still limited by their Redmine permissions.

## Client config — stdio (npx)

```json
{ "mcpServers": { "redmine": {
    "command": "npx", "args": ["-y", "lta-redmine-mcp"],
    "env": { "REDMINE_URL": "https://redmine.example.com", "REDMINE_API_KEY": "<your key>" } } } }
```

Requires Node >= 22.9.

## Client config — HTTP

Start the shared server with `npx lta-redmine-mcp --http` (or `MCP_TRANSPORT=http`), then:

```json
{ "mcpServers": { "redmine": {
    "type": "http", "url": "http://mcp-host:3000/mcp",
    "headers": { "X-Redmine-API-Key": "<your key>" } } } }
```

## Environment

| Var | Default | Meaning |
|-----|---------|---------|
| `REDMINE_URL` | required | Redmine base URL |
| `REDMINE_API_KEY` | required in stdio | Your Redmine API key (stdio only; HTTP takes it per request from the header) |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`; the `--http` flag also selects HTTP |
| `BLOCKED_PROJECT_IDS` | empty | Comma-separated project ids and/or identifiers to hide, e.g. `12,nws-sale`. Not recursive: list subprojects too. A mistyped identifier is not detected — check that `get_project` on it returns `Not found`. |
| `PORT` | `3000` | HTTP port (HTTP only) |
| `MAX_FILE_MB` | `5` | Max attachment size (upload and download) |

## Run from source

```bash
npm install
npm run build
MCP_TRANSPORT=http REDMINE_URL=https://redmine.example.com npm start
```
