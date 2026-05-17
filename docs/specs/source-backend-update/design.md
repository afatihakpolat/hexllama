# Source Backend Update Design

## Solution Summary
Replace the release-asset backend update action with a source-build flow that runs against the configured backend folder as a local llama.cpp git repository. The main process launches a PowerShell helper to fetch/reset/build into a versioned backend directory, then refreshes backend state and rewrites template backend bindings to the new active build.

## Architecture Overview
- Main process owns git/tag checks, source-update orchestration, progress forwarding, backend refresh, and template migration.
- A repo-owned PowerShell helper script performs the Windows-specific toolchain setup and build steps.
- Preload exposes the source update API to the renderer.
- Settings and UpdateBanner invoke the source-build action and refresh the renderer store on success.

## Affected Modules
- `src/main/ipc.ts`
- `src/main/scripts/update-llama-source.ps1`
- `src/preload/index.ts`
- `src/renderer/src/env.d.ts`
- `src/renderer/src/components/SettingsView.tsx`
- `src/renderer/src/components/UpdateBanner.tsx`
- `src/renderer/src/App.tsx`
- `src/shared/types.ts`

## Runtime Flow
1. User clicks the update action in Settings or the update banner.
2. Main process validates that the backend folder is a git repo and no conflicting transfers/builds are active.
3. Main process launches the PowerShell helper with repo root and target ref/tag information.
4. The helper loads the VS build environment if needed, updates the repo, derives the new build number, configures CMake for a new build folder named `b####`, and builds it.
5. Main process parses helper progress output and forwards phase updates to the renderer.
6. After a successful build, main process refreshes backend discovery, sets the new backend active, rewrites saved templates to the new backend name, and returns the refreshed snapshot plus updated templates.
7. Renderer updates store state from the returned payload.

## Build Folder Naming
Read `llama-version.cmake` after the repo update and derive the folder name from the patch component as `b####`. Use that value both for the build output directory and backend display label.

## Template Migration
After the new backend is built, rewrite every saved template that has a `backendVersion` value to the new backend folder name. This ensures preexisting templates use the updated backend automatically while preserving all other template fields.

## Progress Reporting
Reuse the existing `download-progress` channel with source-build phases such as `fetching`, `resetting`, `configuring`, `building`, `finalizing`, and `done`. Percent may stay coarse or phase-based when exact progress is unavailable.

## Failure Handling
Return structured `{ success: false, error }` results for invalid repo roots, missing tools, git failures, CMake failures, or missing executables after build. Leave current backend state unchanged on failure.

## Risks and Tradeoffs
- `git reset --hard` will discard uncommitted local repo changes.
- The build flow is Windows-specific and depends on PowerShell and Visual Studio tooling.
- Template migration removes backend pinning in favor of always following the latest built backend, which matches the requested behavior.

## Testing and Verification
- Run `npm run build`.
- Manual smoke test: run the update flow against a local repo, confirm a new `b####` folder appears, older folders remain, and templates run with the new backend.
