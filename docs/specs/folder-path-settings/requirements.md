# Folder Path Settings Requirements

## Problem Statement
The app hardcodes the models and backend folders to directories under the app root, so users cannot point Hexllama at their preferred storage locations.

## Goal
Allow users to change the default models folder and backend folder from Settings without restarting the app.

## Non-Goals
- Making the templates folder configurable.
- Migrating existing files automatically between folders.
- Supporting per-project path profiles.

## Actors
- Local desktop user managing downloaded models and llama.cpp backends.

## Use Cases
- A user wants models stored on a larger secondary drive.
- A user wants backends stored in a shared tools directory.
- A user wants the app to refresh immediately after changing either folder.

## Functional Requirements
- The app must expose the current models and backend folders in Settings.
- The user must be able to choose a new models folder and a new backend folder using a folder picker.
- The selected folders must persist across app launches.
- The app must refresh the visible models, backends, and resolved paths immediately after a folder change.
- If the active backend no longer exists after a backend folder change, the app must select the first available backend or no backend.
- Folder-opening actions must use the current configured paths, not hardcoded defaults.

## Non-Functional Requirements
- Path changes must not require restarting the app.
- The implementation must keep path validation in the main process.
- The app must create configured folders if they do not already exist.

## Constraints
- The existing Electron IPC architecture remains the integration boundary.
- Renderer code must not write filesystem paths directly.

## Acceptance Criteria
- Changing the models folder updates model listings and folder-open actions immediately.
- Changing the backend folder updates backend listings and active backend selection immediately.
- After restarting the app, the selected folders remain in effect.
- The app still builds successfully.

## Assumptions
- Users will manage any manual file moves between old and new folders outside the app.
- Folder changes can be blocked while downloads are in progress to avoid mixed destinations.
