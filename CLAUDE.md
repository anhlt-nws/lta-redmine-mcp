# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build                                   # nest build -> dist/
npm start                                       # node --env-file-if-exists=.env dist/main
npm run start:dev                               # watch mode, also loads .env
npm test                                        # jest, specs co-located as src/**/*.spec.ts
npx jest src/redmine/redmine.gateway            # one spec file
npx jest -t "getAttachment"                     # tests matching a name
npx tsc --noEmit                                # type-check (ts-jest does not fail on type errors)
npm run lint
```

Node >= 22.9 (`--env-file-if-exists`). Env vars: `REDMINE_URL` (required), `BLOCKED_PROJECT_IDS`, `PORT` (3000), `MAX_FILE_MB` (5) — see `.env.example`. `start:prod` / `start:debug` do NOT load `.env`.

Manual check against a real Redmine: `npx @modelcontextprotocol/inspector` → Streamable HTTP, `http://localhost:3000/mcp`, header `X-Redmine-API-Key`.

Design docs: `docs/superpowers/specs/2026-10-22-redmine-mcp-design.md` (binding requirements, incl. §7 known limitations) and `docs/superpowers/plans/2026-10-22-redmine-mcp.md`.

## Architecture

Stateless MCP server: `POST /mcp` (`src/mcp/mcp.controller.ts`) builds a fresh `McpServer` + `StreamableHTTPServerTransport` per request, with tools bound to that caller's `X-Redmine-API-Key`. Nothing is stored between requests; GET/DELETE `/mcp` return 405.

The security invariant — **projects in `BLOCKED_PROJECT_IDS` are invisible and unwritable** — lives entirely in `src/redmine/redmine.gateway.ts`:

- It is the only code that calls `fetch`. Tool files (`src/mcp/tools/*.tools.ts`) contain no blocking logic; they declare zod input schemas and call the gateway. The zod schemas are the trust boundary: the gateway spreads tool args into Redmine payloads, so a tool must only declare fields that are safe to forward.
- Single reads check `project.id` from the Redmine response (not the caller's ref) via `ProjectAccessPolicy.assertAllowed`, which throws `Not found` — identical to Redmine's 404 so blocked and nonexistent are indistinguishable.
- Lists always re-filter after fetching (`page()`), because Redmine includes subproject data even when `project_id` is given. Pagination returns `{ items, has_more }`, never `total_count`.
- Writes check every project involved (current issue project, new project, log-time target) **before** sending anything, including before any `POST /uploads.json`.
- Attachments can only be reached via `issue_id` + `attachment_id` (Redmine's attachment JSON has no project). Downloads use a URL built from `REDMINE_URL`, never Redmine's `content_url`; `fetch` uses `redirect: 'error'` so the API key never follows a redirect.
- Blocking is NOT recursive: only listed projects are blocked; admins list subprojects themselves.
- `BLOCKED_PROJECT_IDS` may hold identifiers. Every public gateway method first calls `resolveBlocked(apiKey)`, which maps pending identifiers to ids with the caller's key (success cached globally; 404/403 skipped and retried next call; other errors fail closed). Internal calls between methods must use the private `loadProject`/`projectId`/`loadIssue`/`update` helpers, not the public methods, or resolution repeats — a test asserts exactly one lookup per public method, so add new public methods to it.

Errors: gateway throws `RedmineError` (user-facing message); `toolResult()` (`src/mcp/tools/result.ts`) turns it into `isError: true`, anything else is rethrown. `MAX_FILE_MB` bounds total upload size per call and each download; `configureApp()` (`src/app.setup.ts`) raises the Express JSON body limit to fit base64, so the app must be created with `{ bodyParser: false }`.

Tests mock `fetch` with `mockFetch()` (`src/redmine/fetch-mock.ts`, test-only, excluded from the build); routes are keyed `"METHOD /pathname"` and unknown routes return 404. Security tests assert on the recorded calls (e.g. "no PUT was sent"), not only on the thrown error — keep that pattern.

## Mistakes log

Whenever an AI working in this repo makes a mistake (a bug it introduced, a wrong assumption, a missed requirement caught by review or by the user), append an entry here in the same turn it is fixed: what went wrong, then the rule that prevents it. Keep entries one or two lines; merge with an existing entry instead of repeating it.

- **Leaked a blocked project through a reference field.** Project JSON's `parent: {id, name}` exposed a blocked parent's name on a visible child. → Any field that references another project (`parent`, `project`, shared `fixed_version`, …) must be checked or stripped, not just the top-level object's id.
- **Trusted Redmine fields to always be present.** `content_type` can be null; a non-JSON (HTML login page) 2xx body crashed `JSON.parse`. → Default optional fields once, in the gateway, and map every unexpected Redmine response to a `RedmineError`.
- **Returned image types Claude rejects.** Every `image/*` was sent as MCP image content; svg/bmp/tiff break the client. → Only png, jpeg, gif, webp go out as image content.
- **Forgot framework defaults.** Express's 100 KB JSON body limit would reject every base64 upload. → When a feature moves big payloads, check body-size, timeout and similar defaults on every hop.
- **Plain-object lookup with user input.** `{open:'o'}[status]` returned an inherited function for `status='constructor'`. → Use `Object.hasOwn` or a `Map` for lookups keyed by input.
- **TS1272 under isolatedModules + emitDecoratorMetadata.** → Import types used in decorated constructors as `import { type X }`.
- **Wrote a test for a path that cannot happen.** A `null` content_type test (forced with `as any`) checked a default the gateway already made unreachable. → Test where the behavior actually lives; if a test needs `as any` to construct its input, question whether the path exists.
- **Stated Redmine API details from memory as fact.** → Mark them unverified until checked on a real Redmine. All verified on redmine.newwave.vn (2026-10-22; writes on sandbox project `hcs_figma`, then cleaned up): `f[]/op/v` subject filter, `GET /attachments/download/{id}` without filename, `POST /uploads.json` + `uploads` on create/update, `DELETE /attachments/{id}.json`, image download, identifier resolution, every blocked write rejected with nothing changed.
- **Ran `/security-review` without a remote.** It diffs against `origin/HEAD`, which does not exist here. → Add a remote first, or review a commit range manually.
