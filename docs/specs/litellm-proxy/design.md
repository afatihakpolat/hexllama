# LiteLLM Proxy Design

## Solution Summary
Introduce LiteLLM as a second provider type that coexists with the existing local llama.cpp flow, and add a dedicated LiteLLM manager page that can inspect the system Python runtime, install or update LiteLLM, persist a local proxy config file, start or stop a managed LiteLLM process, and manage Hexllama's connection settings for model discovery and chat.

## Architecture Overview
- Main process owns LiteLLM settings persistence, local manager settings persistence, Python/LiteLLM detection, install/update commands, local proxy lifecycle, connection tests, remote model discovery, and proxied chat-completion requests.
- Preload exposes a typed LiteLLM API to the renderer.
- Shared template types become provider-aware while preserving backward compatibility for local templates.
- Renderer gets a dedicated LiteLLM navigation page.
- Create Modal becomes provider-aware and switches between local template fields and LiteLLM template fields.
- Model cards dispatch run behavior by provider type.
- A dedicated renderer chat component talks to LiteLLM through IPC.

## Affected Modules
- `src/shared/types.ts`
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/renderer/src/env.d.ts`
- `src/renderer/src/store/useStore.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/LiteLlmView.tsx`
- `src/renderer/src/components/SettingsView.tsx`
- `src/renderer/src/components/CreateModal.tsx`
- `src/renderer/src/components/ModelCard.tsx`
- `src/renderer/src/components/ChatWindow.tsx`
- `src/renderer/src/components/LiteLlmChatWindow.tsx`

## Data Model Changes
- Add `providerType?: 'local' | 'litellm'` to templates and treat missing values as `local`.
- Keep `backendVersion` and `modelPath` as local-template fields.
- Add `remoteModel?: string` and optional remote chat metadata for LiteLLM templates.
- Add a `LiteLlmSettings` type in shared types plus a sanitized `LiteLlmSettingsSnapshot` that omits the raw API key.
- Add LiteLLM manager types for install status, runtime settings, config text, process status, and recent logs.

## Runtime Flow
1. App bootstraps saved LiteLLM connection settings plus local manager settings and config text.
2. The LiteLLM page checks the system Python runtime, detects LiteLLM installation status, and fetches the latest PyPI version when relevant.
3. The LiteLLM page lets the user install or update LiteLLM through the detected system Python runtime.
4. The LiteLLM page lets the user edit and save the app-managed LiteLLM `config.yaml`.
5. The LiteLLM page lets the user start and stop a managed local LiteLLM proxy process.
6. The LiteLLM page separately lets the user save the Hexllama connection base URL and API key, test the proxy, and refresh remote model options.
7. Create Modal lets the user choose `Local` or `LiteLLM` as the template provider.
8. Local templates continue through the existing backend/model execution path.
9. LiteLLM templates use the configured remote model and open a dedicated chat window route.
10. The LiteLLM chat window sends messages through main-process IPC to the configured proxy.

## IPC/API Changes
- Add `get-litellm-manager`.
- Add `save-litellm-manager-settings`.
- Add `save-litellm-config`.
- Add `install-litellm`.
- Add `update-litellm`.
- Add `start-litellm-proxy`.
- Add `stop-litellm-proxy`.
- Add `get-litellm-settings`.
- Add `save-litellm-settings`.
- Add `test-litellm-connection`.
- Add `list-litellm-models`.
- Add `litellm-chat-completion`.
- Add `open-litellm-chat-window`.

## Persistence
- Store LiteLLM settings in a JSON file under Electron `userData`.
- Store LiteLLM manager runtime settings in a second JSON file under Electron `userData`.
- Store the managed LiteLLM proxy config as an app-owned `config.yaml` under Electron `userData`.
- Persist the raw API key only in the main-process settings file.
- Renderer consumers should receive `hasApiKey` rather than the stored key value during bootstrap.

## UI Decisions
- Keep local backend controls in Settings exactly where they are.
- Remove the old LiteLLM section from the general Settings page.
- Add a separate LiteLLM navigation entry and page.
- Put install/update/runtime controls, connection settings, config editing, and logs on the LiteLLM page.
- In Create Modal, show a provider selector near the top of the form.
- For LiteLLM templates, replace backend/model file controls with remote model controls.
- Use a dedicated chat component for LiteLLM instead of reusing the iframe wrapper for llama.cpp web UI.

## Failure Handling
- Invalid LiteLLM settings return structured `{ success: false, error }` responses.
- A failed model-list refresh must not clear a previously usable manual remote model value.
- A failed chat request should stay inside the LiteLLM chat UI and show the error without mutating saved template configuration.
- Starting the managed LiteLLM process waits for the proxy to become reachable before reporting success.
- Changing managed host, port, or log level while the proxy is already running is rejected instead of silently desynchronizing the connection URL from the live process.

## Risks and Tradeoffs
- A single global LiteLLM configuration is simpler but does not support multiple remote provider profiles.
- Non-streaming chat completions are lower risk for the first slice than streaming responses.
- Storing API keys locally in app-owned config is acceptable for this desktop-first workflow but is not encrypted secret storage.
- Managing LiteLLM through the user's system Python is simpler than shipping a bundled runtime, but it depends on Python being installed locally.

## Testing and Verification
- Run `npm run build`.
- Verify the LiteLLM page shows install/runtime status and config text.
- Verify install and update commands work against the detected local Python runtime.
- Verify starting the local proxy only reports success once the proxy is actually reachable.
- Verify local templates are unaffected.
- Verify LiteLLM settings persist and can be tested.
- Verify LiteLLM model listing succeeds against a real proxy.
- Verify LiteLLM templates open the remote chat UI and return responses.