# Llama Proxy Usage Stats Tasks

- DONE: Locked the v1 counted scope to proxied `/v1/chat/completions` and `/v1/completions`; other `/v1/*` requests are forwarded and recorded as non-exact rows unless llama.cpp returns exact `usage` or `timings`.
- DONE: Added shared usage/proxy type definitions in `src/shared/types.ts` and created focused main-process helper modules in `src/main/llamaProxy.ts`, `src/main/usageLedger.ts`, and `src/main/runtimePorts.ts`.
- DONE: Updated the main launch and stop flow in `src/main/ipc.ts` so `template.serverPort` is now the proxy port and the upstream `llama-server` runs on a hidden loopback port.
- DONE: Implemented tracked API forwarding plus exact `usage` and `timings` extraction for supported JSON and streaming responses in `src/main/llamaProxy.ts`.
- DONE: Persisted normalized request records under Electron `userData`, rebuild rollups at startup, and exposed live-session plus historical snapshot helpers from the main process.
- DONE: Exposed usage snapshot methods and live update subscriptions through `src/preload/index.ts` and `src/renderer/src/env.d.ts`.
- DONE: Added a dedicated renderer page in `src/renderer/src/components/UsageStatsView.tsx` and wired it through `src/renderer/src/App.tsx` and `src/renderer/src/components/Sidebar.tsx`.
- DONE: Kept renderer usage query/load state local to `UsageStatsView.tsx` instead of extending Zustand, to avoid broad store churn for a page-scoped feature.
- IN_PROGRESS: Add the smallest viable automated tests for port rewriting, response extraction, ledger aggregation, and proxy forwarding behavior, then complete a manual API smoke test in the running app.
- DONE: Updated `docs/HANDOFF.md` and `docs/specs/llama-proxy-usage-stats/implementation-notes.md` with implementation findings, open issues, and the next recommended execution step.