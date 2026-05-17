# Folder Path Settings Implementation Notes

- Initial discovery confirmed that `MODELS_DIR` and `BACKEND_DIR` are fixed module-level constants in `src/main/ipc.ts` and drive listing, downloads, backend discovery, and folder-open actions.
- `src/renderer/src/components/ModelsView.tsx` currently bypasses store paths and opens a literal `models` directory, which must be corrected when paths become configurable.
- `activeBackend` and `commandsSchema` store setters need to allow `null` because a backend folder change can remove all discovered backends.
- Final implementation persists `models` and `backend` overrides in Electron `userData/folder-paths.json`, keeps `templates` on the default app path, and returns a filesystem snapshot to the renderer after each applied change.
- Path changes are now blocked in both the renderer and the main process while model or backend downloads are active, so in-flight downloads cannot be hidden by a mid-transfer folder switch.
- Backend discovery now filters out directories that do not contain a detected runnable executable, so selecting a parent folder no longer shows unrelated build/source subfolders in the UI.
- Model discovery now returns relative subfolder paths for grouping in the Models view and excludes filenames containing `mmproj`, so projector weights are not shown as normal runnable models.
- The Models view now renders each folder group as a collapsible section, expanded by default, so larger model libraries are easier to scan without losing the subfolder categorization.
- The Models view now builds a nested folder tree from relative model paths, starts folders collapsed by default, and shows aggregated size totals at each folder level so top-level groups like `UNSLOTH` can expand into their model-family subfolders.
- Backend discovery now derives a `displayName` like `b9202` from `llama-version.cmake` when present, so the UI can show the actual llama.cpp build number while still using the backend folder name internally for activation and command-file lookup.
- The update check now uses GitHub release metadata only for version detection and returns no prebuilt assets, so the app can notify about newer llama.cpp releases without offering prebuilt downloads.
- Update detection now reads upstream `b####` tags via `git ls-remote` and compares them against installed backend build labels derived from `llama-version.cmake`, which fixes false positives for source-built backends stored in generic folders like `build`.
- Validation: `npm run build` passed after the main-process refactor, after the renderer wiring, and again after the follow-up fixes from review.
