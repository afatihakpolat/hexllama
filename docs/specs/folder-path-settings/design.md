# Folder Path Settings Design

## Solution Summary
Replace the hardcoded models and backend directories in the main IPC layer with persisted, configurable paths. Expose folder-picking and path-setting IPC handlers, then add a Settings UI section that applies the returned filesystem snapshot to renderer state.

## Architecture Overview
- Main process owns path defaults, persisted overrides, directory creation, validation, and snapshot generation.
- Preload exposes typed bridge methods for choosing and applying a folder.
- Renderer Settings uses those APIs and refreshes Zustand state from the returned snapshot.

## Affected Modules
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/renderer/src/env.d.ts`
- `src/renderer/src/store/useStore.ts`
- `src/renderer/src/components/SettingsView.tsx`
- `src/renderer/src/components/ModelsView.tsx`

## Data Flow
1. Settings requests a folder picker for `models` or `backend`.
2. Main process returns a chosen directory or `null`.
3. Settings sends the selected directory back to the main process to persist and apply.
4. Main process updates the stored path config, ensures directories exist, and returns a snapshot containing paths, model list, and backend list.
5. Renderer updates store state and reselects the active backend if possible.

## IPC/API Changes
- Add `chooseAppFolder(kind)`.
- Add `setAppFolder(kind, path)` returning `{ success, snapshot?, error? }`.
- Keep `getPaths()` for bootstrap and existing UI consumers.

## Persistence
Store only `models` and `backend` overrides in a JSON file under Electron `userData`. Keep `templates` on the default path.

## Edge Cases
- Selected folder does not exist yet: create it.
- Selected backend folder has no backends: clear active backend.
- Selected path is inaccessible or invalid: return an error and leave current config unchanged.
- Downloads in progress: block path changes from Settings.

## Failure Handling
Main process returns structured `{ success: false, error }` responses for invalid path changes. Renderer surfaces the error with `alert` and preserves current state.

## Testing and Verification
- Run the production build after implementation.
- Confirm no remaining renderer code hardcodes the models folder path.

## Alternatives Considered
- Keeping path changes in renderer local state only: rejected because the main process owns filesystem access.
- Making all app folders configurable: rejected to keep the scope limited to the user request.
