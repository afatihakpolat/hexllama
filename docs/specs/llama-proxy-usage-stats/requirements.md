# Llama Proxy Usage Stats Requirements

## Problem Statement
LlamaDeck can launch local llama.cpp servers and stream stdout/stderr, but it does not own the public API port or record request-level usage. The app is used almost entirely through the API, so operators need exact live and historical usage statistics for local models without changing client ports or relying on token estimation.

## Goal
- Add API-first live and historical usage statistics for local llama.cpp models.
- Keep each template's public port at `template.serverPort` while moving `llama-server` to a hidden internal upstream port.
- Count prompt, completion, and total tokens only from server-returned `usage` and `timings` data observed by a LlamaDeck-owned local proxy layer.

## Non-Goals
- Rebuilding the feature around the llama.cpp web UI.
- Estimating tokens client-side for requests that do not return exact usage data.
- Adding remote-provider analytics or cross-machine usage aggregation.
- Adding reporting/export, quotas, or billing workflows in the first implementation.
- Redesigning the template model beyond what is required to show and group usage data.

## Actors
- A desktop user who runs local llama.cpp templates primarily as API endpoints.
- A desktop user who wants live usage visibility while a model is serving requests.
- A desktop user who wants persisted historical totals after the model or app restarts.

## Use Cases
- A user starts an API-only template and keeps existing clients pointed at the same port while LlamaDeck begins collecting live usage.
- A user opens a usage page and sees live request counts, token totals, and recent request outcomes for running models.
- A user reopens the app later and reviews historical totals by template or time window.
- A user correlates a spike in failures or latency with recent request and token activity while still using the existing Live Output page for raw process logs.

## Functional Requirements
- Starting a local template must bind a LlamaDeck-owned proxy on the saved `serverPort`.
- The main process must allocate a hidden upstream port for `llama-server` and override any launched `--port` argument so the child process does not bind the public port directly.
- The proxy must forward local llama.cpp API traffic to the upstream server while preserving request and response behavior for supported endpoints.
- The proxy must track only the endpoints and response shapes that reliably expose server-returned `usage` or `timings`; unsupported endpoints may be forwarded but must not inflate exact-token totals.
- The app must maintain live per-session usage totals for each running template.
- The app must persist completed request records so historical usage survives app restarts.
- The renderer must expose a dedicated usage statistics surface for live sessions and historical rollups.
- The existing Live Output flow must continue to show stdout/stderr independently of the new usage tracking.
- Failed or uncounted requests must still be visible as request events, but exact token totals must include only records with server-returned usage data.
- Stopping a model must stop both the proxy and the upstream `llama-server` process and finalize that runtime session.

## Non-Functional Requirements
- Existing API clients must continue using the same configured template port.
- Usage persistence must be append-safe and must not block the hot request path with large synchronous writes.
- Proxy bind failures, upstream forwarding failures, and parse failures must surface clear user-facing errors or statuses.
- The app build must continue to pass after the implementation.

## Constraints
- The existing Electron IPC boundary remains the privileged integration point.
- Local model launch and process lifecycle are currently owned by `src/main/ipc.ts`.
- Renderer application state is managed with Zustand.
- Live Output remains in-memory and should not become the persistence layer for statistics.
- The implementation should follow the user's API-first priority; llama.cpp web UI behavior is secondary.

## Acceptance Criteria
- Starting a template launches a proxy on `template.serverPort` and runs `llama-server` on a different hidden upstream port.
- Existing local API clients continue to call the saved template port without reconfiguration.
- Successful proxied requests update live per-template request and token totals using only server-returned usage or timings.
- Historical usage data survives an app restart and can be filtered by template and time window.
- Requests that do not provide exact usage remain visible in history but are excluded from exact token totals.
- The existing Live Output page still shows stdout/stderr for the running upstream process.
- `npm run build` succeeds after the implementation.

## Open Questions
- Which llama.cpp endpoints and versions provide reliable `usage` and `timings` data for streaming responses, and does the supported build require a specific streaming option such as usage-in-final-chunk behavior?
- Should the proxy support llama.cpp web UI passthrough as a best-effort compatibility path, or should the first release explicitly scope usage stats to API-first templates only?
- Should proxy binding preserve explicit advanced host/listen flags from the template args, or should the first implementation normalize all traffic to loopback-only behavior?
- What retention, reset, export, or compaction controls are required for the persisted history ledger?
- Should historical grouping key off template ID, model path, or both when templates are duplicated or renamed?