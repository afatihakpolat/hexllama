# Source Backend Update Requirements

## Problem Statement
The app currently treats backend updates as downloadable release assets, but the desired workflow is to update a local llama.cpp git checkout and compile a new backend build from source.

## Goal
Allow the app to update a local llama.cpp repository from source, compile a new backend into a versioned build folder such as `b9202`, keep older build folders intact, and make existing templates use the new backend automatically.

## Non-Goals
- Supporting non-Windows build environments in this implementation.
- Managing arbitrary external build scripts outside the app.
- Deleting or migrating older backend build folders automatically.

## Actors
- A Windows user maintaining a local llama.cpp source checkout with MSVC, CMake, Ninja, and CUDA configured.

## Use Cases
- A user checks for updates and wants to build the latest upstream llama.cpp source from within the app.
- A user keeps older compiled builds for rollback while making the newest build active.
- A user expects existing templates to run against the newest compiled backend after an update.

## Functional Requirements
- The app must check upstream llama.cpp git tags for the latest `b####` version.
- The app must treat the configured backend folder as the local llama.cpp repository root for source updates.
- The app must provide an action to fetch/reset the repo and compile a new build from source.
- The app must create the new backend in a versioned subfolder named from the resulting build number.
- The app must leave older backend folders untouched.
- The app must refresh backend discovery and set the newly built backend active after a successful update.
- The app must repoint existing saved templates to the new backend after a successful update.
- The app must surface update progress phases in the UI.

## Non-Functional Requirements
- The app must fail clearly if the configured backend folder is not a git repo or required build tools are unavailable.
- The update flow must block while model downloads or running backend update jobs are active.
- Template rewrites must preserve unrelated template fields.

## Constraints
- The implementation may rely on PowerShell on Windows.
- The backend repo is assumed to be the configured backend folder path.
- Build numbering must come from llama.cpp version metadata, not folder names.

## Acceptance Criteria
- Triggering an update from the app pulls/resets the local repo, configures CMake, builds into a new `b####` folder, and leaves older folders intact.
- The Installed Backends list shows the newly built backend and marks it active.
- Existing templates run against the new backend without manual reassignment.
- The app build succeeds after the implementation.

## Assumptions
- The user has local permission to modify the configured llama.cpp repository.
- The configured backend folder points at a working llama.cpp repo root.
