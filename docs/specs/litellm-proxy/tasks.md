# LiteLLM Proxy Tasks

- DONE: Add provider-aware template and LiteLLM settings types while preserving backward compatibility for local templates.
- DONE: Add main-process LiteLLM settings persistence, connection testing, remote model listing, and chat-completion IPC handlers.
- DONE: Expose LiteLLM APIs through preload and renderer typings.
- DONE: Extend renderer bootstrap/state for LiteLLM settings and remote model options.
- DONE: Add a dedicated LiteLLM navigation page and remove the old LiteLLM section from the general Settings page.
- DONE: Add system-Python-based LiteLLM detection plus install and update actions in the LiteLLM page.
- DONE: Add app-managed LiteLLM runtime settings, config persistence, and start/stop proxy controls.
- DONE: Add Hexllama connection controls to the LiteLLM page with save, clear key, test connection, and refresh models actions.
- DONE: Update template creation/editing to support Local vs LiteLLM provider-specific fields.
- DONE: Add a dedicated LiteLLM chat window path and route LiteLLM templates to it instead of local process spawning.
- DONE: Validate with `npm run build` and update handoff notes.