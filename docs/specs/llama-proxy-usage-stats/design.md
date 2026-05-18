# Llama Proxy Usage Stats Design

## Solution Summary
Introduce a LlamaDeck-owned local HTTP proxy per running template. The proxy binds the public template port, forwards supported API traffic to a hidden upstream `llama-server` port, extracts exact usage and timing data from upstream responses, updates live in-memory session totals, and persists compact per-session summaries for historical views.

## Architecture Overview
- Main process owns proxy-backed runtime launch, hidden upstream port allocation, request forwarding, usage extraction, live session state, and persisted history.
- `src/main/ipc.ts` keeps IPC registration and top-level launch/stop orchestration, but the proxy and usage logic should live in focused helper modules instead of further inflating the IPC file.
- Preload exposes typed usage snapshot methods and live-update subscriptions to the renderer.
- Renderer keeps filter/load state local to the Usage Stats page; live recent-request buffering remains main-process-owned and historical rollups come from persisted session summaries.
- Live Output stays separate and continues to stream raw stdout/stderr from the upstream child process.

## Affected Modules
- `src/main/ipc.ts`
- `src/main/userData.ts`
- `src/main/llamaProxy.ts` or `src/main/runtimeProxy.ts`
- `src/main/usageLedger.ts`
- `src/main/runtimePorts.ts`
- `src/preload/index.ts`
- `src/renderer/src/env.d.ts`
- `src/shared/types.ts`
- `src/renderer/src/store/useStore.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/Sidebar.tsx`
- `src/renderer/src/components/UsageStatsView.tsx`
- `src/renderer/src/components/ModelCard.tsx`
- `src/renderer/src/components/CreateModal.tsx`
- `src/renderer/src/components/LiveOutputView.tsx`

## Data Model
- `LlamaProxySession`
  - `launchId`, `templateId`, `templateName`, `modelPath`, `backendVersion`
  - `pid`, `publicPort`, `upstreamPort`, `startedAt`, `stoppedAt`, `status`
  - live totals: `requestCount`, `successCount`, `errorCount`, `exactUsageCount`, `promptTokens`, `completionTokens`, `totalTokens`
  - live health: `activeRequests`, `lastRequestAt`, `lastError`, `lastEndpoint`
- `UsageRequestRecord`
  - `id`, `launchId`, `templateId`, `templateNameSnapshot`, `modelPathSnapshot`
  - `method`, `path`, `statusCode`, `startedAt`, `finishedAt`, `durationMs`, `stream`
  - `countedExactly`, `promptTokens`, `cacheTokens`, `completionTokens`, `totalTokens`
  - optional timings snapshot from upstream response data
  - optional error fields when forwarding or parsing fails
- `UsagePersistedSession`
  - `launchId`, `templateId`, `templateName`, `modelPath`, `backendVersion`
  - `startedAt`, `stoppedAt`, `status`, `lastRequestAt`, `lastEndpoint`, `lastError`
  - summary totals: `requestCount`, `successCount`, `errorCount`, `exactUsageCount`, `promptTokens`, `cacheTokens`, `completionTokens`, `totalTokens`
  - compact `dailyRollups` array for historical day-window aggregation without keeping the full request log
- `UsageHistorySnapshot`
  - `liveSessions`
  - `recentRequests` (in-memory only, capped to the latest 20 requests in the current app run)
  - rollups by template and by day for the selected time window

## Runtime Flow
1. Renderer starts a template through the existing `run-model` path.
2. Main process allocates an unused hidden upstream port and rewrites the spawned `llama-server` args so the child binds that upstream port instead of the template's public port.
3. Main process starts a proxy server on `template.serverPort` and registers the running proxy session under the template ID.
4. The proxy forwards supported API requests to the upstream server.
5. For non-streaming JSON responses, the proxy buffers the upstream body, forwards the response, and extracts `usage` and `timings` before updating live totals and history.
6. For streaming responses, the proxy tees the stream to the client while inspecting terminal usage-bearing chunks when the upstream build supports them. If no exact usage is returned, the request is recorded as visible but uncounted.
7. Completed tracked requests update the live session aggregate in memory, are added to the in-memory recent-request buffer, and are merged into the persisted per-session summary on disk.
8. Main process broadcasts lightweight usage-update events so the renderer can refresh live counters without polling the full history on every request.
9. Stopping the model stops the proxy, the upstream child process, and marks the persisted session summary closed while leaving compact historical totals intact.

## Port and Launch Rules
- `template.serverPort` remains the public client-facing port and is owned by the proxy while the model is running.
- The upstream `llama-server` port is session-scoped, hidden, and never persisted to the template.
- The launch path must strip or replace any user-provided `--port` value so the upstream child cannot steal the public port.
- Launch-mode handling should stay compatible with current templates, but the first implementation should prioritize API-only traffic and treat web UI passthrough as secondary.

## Persistence
- Store compact per-session JSON files under Electron `userData/usage-sessions/` and update the active session file after each tracked request.
- Keep `Recent Requests` in memory only, capped to the latest 20 requests for the current app run.
- Migrate older append-only request-ledger history forward into session files once, then stop using the request log as the primary history source.
- Preserve daily rollup fidelity inside each session file so `Today`, `7 Days`, and `All Time` can be computed without storing every request forever.

## IPC and Renderer API
- Add `get-usage-history(query?)` for initial page loads and filter changes.
- Add `get-live-usage-sessions()` or fold live data into the history snapshot.
- Add `on-usage-updated` for incremental live-session and recent-request refreshes.
- Keep the existing `run-model` and `stop-model` renderer contract as stable as possible; the proxy behavior should be primarily a main-process implementation detail.

## UI
- Add a dedicated `Usage Stats` navigation item and page instead of overloading `Live Output`.
- Show live sessions first: running template name, public port, requests, exact-token totals, last request, and current active-request count.
- Show recent request history next: timestamp, template, endpoint, status, duration, exact-token totals, and whether the request was counted exactly.
- Show historical rollups by template and by time window, with simple filters such as `Today`, `7 Days`, and `All Time`.
- Keep Live Output focused on raw stdout/stderr and optionally add a cross-link to Usage Stats when a model is running.
- Update small copy surfaces so `serverPort` is described as the public API port rather than the direct llama-server bind.

## Failure Handling
- If the proxy cannot bind the public port, fail model start before reporting success.
- If the upstream process exits, stop the proxy and close the live session cleanly.
- If forwarding fails while the model is still starting, return a structured local `5xx` response and record the request as failed.
- If a response cannot be parsed for exact usage, keep the request visible but mark it `countedExactly: false` instead of guessing.
- If the ledger write fails, keep the model serving path alive, surface the persistence error in the app, and retain in-memory live totals for the current session.

## Testing and Verification
- Add helper-level tests for upstream port rewriting, tracked-endpoint detection, JSON response extraction, SSE final-usage extraction, and ledger rollups.
- Add an integration-style proxy test with a stub upstream server to verify that the public port stays stable, the upstream port stays hidden, and usage records are appended correctly.
- Run `npm run build` after implementation.
- Manual smoke test: run an API-only template, send proxied requests through the public port, verify live counters update, stop and restart the app, and verify the same requests appear in historical views.

## Risks and Tradeoffs
- Streaming response accounting is only exact when the upstream build emits usage data in a machine-readable terminal chunk.
- A proxy hop adds implementation complexity and a small amount of latency, but it gives LlamaDeck reliable ownership of the public API surface.
- Session-summary files are much smaller than a raw request log, but request-level history is intentionally ephemeral and limited to the current app run.

## Alternatives Considered
- Parsing stdout logs for usage: rejected because it is less reliable than server-returned API data and mixes transport telemetry with human-facing process output.
- Estimating tokens with a local tokenizer: rejected because the user explicitly asked for exact accounting from the server response path.
- Reusing the existing Live Output page as the primary stats UI: rejected because raw logs and structured request analytics have different retention and interaction needs.