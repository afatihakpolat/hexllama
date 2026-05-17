# Handoff

## Completed
- Replaced the old release-download update flow with an in-app Windows source-build flow for llama.cpp.
- Added main-process orchestration that fetches the latest upstream `b####` tag, checks out that tag, configures CMake/CUDA tooling, builds into a versioned backend folder, and refreshes the renderer snapshot on success.
- Updated Settings and the update banner to trigger source builds, show phase-based progress, support cancel, and refresh backends/templates/active backend after success.
- Preserved existing versioned backend folders and repointed pinned templates to the newly built backend automatically.
- Added LiteLLM as a second provider mode beside local llama.cpp templates.
- Added a dedicated LiteLLM navigation page with system-Python detection, LiteLLM install/update actions, app-managed runtime settings, config editing, start/stop controls, and runtime logs.
- Added LiteLLM proxy settings persistence, connection testing, remote model discovery, provider-aware templates, and a dedicated in-app LiteLLM chat window path.
- Kept existing local templates working unchanged while defaulting new templates to local provider mode unless explicitly switched to LiteLLM.

## Verification
- `npm run build`
- `npm run build` after renderer/source-update review fixes
- `npm run build` after LiteLLM provider implementation and review fixes
- `npm run build` after the dedicated LiteLLM manager page and local proxy control flow

## Next Recommended Check
- Manual smoke test in the running app: point the backend folder at a llama.cpp repo, run "Check Now", trigger "Build From Source", confirm a new `b####` folder appears without deleting older builds, confirm pinned templates move to the new backend, and confirm cancel stops without an error alert.
- Manual smoke test for LiteLLM manager: open the LiteLLM page, confirm Python detection, install or update LiteLLM if needed, save the default config, start the proxy, set Hexllama to the local proxy URL, refresh remote models, create a LiteLLM template, confirm it opens the in-app chat window, and confirm a local template still starts against a local backend as before.
