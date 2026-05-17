# LiteLLM Proxy Requirements

## Problem Statement
Hexllama currently supports provider-aware LiteLLM templates, but users still need to manage LiteLLM itself outside the app. That splits the workflow between Hexllama and an external shell for checking whether LiteLLM is installed, installing or updating it, editing the proxy config, and starting or stopping the proxy.

## Goal
Allow Hexllama to support LiteLLM as a second provider beside local llama.cpp and to manage a local LiteLLM proxy from the UI so users can install it, update it, edit its config, run it locally, and use it from LiteLLM templates without leaving the app.

## Non-Goals
- Replacing or removing local llama.cpp workflows.
- Supporting arbitrary provider plugins in this implementation.
- Adding multi-profile provider management in the first implementation.
- Implementing non-OpenAI-compatible LiteLLM request formats.
- Bundling a private Python runtime inside the app in this implementation.

## Actors
- A desktop user who wants to keep using local llama.cpp templates.
- A desktop user who wants some templates to run through a LiteLLM proxy instead of a local backend.

## Use Cases
- A user checks whether Python and LiteLLM are available on the current computer.
- A user installs or updates LiteLLM from Hexllama through the detected system Python runtime.
- A user edits the LiteLLM `config.yaml` from a dedicated page in the app.
- A user starts and stops a local LiteLLM proxy from Hexllama.
- A user saves global LiteLLM proxy connection settings in the app.
- A user fetches the list of available remote models from the LiteLLM proxy.
- A user creates a template that targets a LiteLLM remote model instead of a local GGUF file.
- A user keeps existing local templates unchanged while adding LiteLLM templates for remote usage.
- A user opens a chat session backed by LiteLLM from a saved template.

## Functional Requirements
- The app must preserve the existing local llama.cpp template workflow.
- The app must support a provider-aware template model that distinguishes between local and LiteLLM templates.
- The app must provide a dedicated LiteLLM navigation page separate from the general llama.cpp settings page.
- The app must detect whether Python 3 is available on the current system.
- The app must detect whether LiteLLM is installed for the detected system Python runtime.
- The app must provide a UI action to install LiteLLM when it is missing.
- The app must provide a UI action to check for and apply LiteLLM updates when it is already installed.
- The app must provide UI controls for the local LiteLLM host, port, and log level.
- The app must persist a LiteLLM `config.yaml` file under app-managed storage and allow editing it from the UI.
- The app must support starting and stopping a managed local LiteLLM proxy process from the main process.
- The app must persist LiteLLM connection settings in the main process.
- The app must support saving at least a LiteLLM base URL and API key.
- The app must provide a way to test LiteLLM connectivity.
- The app must provide a way to fetch remote model identifiers from the LiteLLM proxy.
- The app must allow manual remote model entry when automatic model listing is unavailable or fails.
- The template editor must show local-only fields for local templates and LiteLLM-specific fields for LiteLLM templates.
- Running a LiteLLM template must not spawn a local llama.cpp process.
- The app must provide an in-app LiteLLM chat surface for LiteLLM templates.

## Non-Functional Requirements
- Existing templates without provider metadata must remain valid and behave as local templates.
- LiteLLM credentials should remain main-process-owned where practical.
- Failures to connect to LiteLLM or list models must surface clear user-facing errors.
- Starting LiteLLM must not report success before the managed proxy is actually reachable.
- The app build must continue to pass after the implementation.

## Constraints
- The existing Electron IPC boundary remains the integration point between renderer and privileged operations.
- The LiteLLM integration targets an OpenAI-compatible proxy surface.
- The current local chat iframe flow is specific to llama.cpp web UI and cannot be reused unchanged for LiteLLM.
- The first local-manager implementation relies on the user's system Python runtime instead of shipping a bundled Python environment.

## Acceptance Criteria
- Users can open a dedicated LiteLLM page in the app.
- Users can see whether Python and LiteLLM are installed on the current computer.
- Users can install LiteLLM when it is missing and update it when a newer version is available.
- Users can save a LiteLLM runtime host, port, and config file from the app.
- Users can start and stop a managed local LiteLLM proxy from the app.
- Users can save a LiteLLM base URL and API key from the dedicated LiteLLM page.
- Users can test the LiteLLM connection and refresh remote model options from the app.
- Users can create a template that uses LiteLLM instead of a local backend.
- Existing local templates continue to run exactly as before.
- Running a LiteLLM template opens an in-app chat interface backed by the configured LiteLLM proxy.
- `npm run build` succeeds after the implementation.

## Assumptions
- The LiteLLM proxy exposes OpenAI-compatible `/v1/models` and `/v1/chat/completions` endpoints.
- A single global LiteLLM proxy configuration is sufficient for the first implementation.
- The user's system Python environment is the supported install and update target for LiteLLM in this phase.