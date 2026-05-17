# LiteLLM Proxy Implementation Notes

- Local llama.cpp usage remains the default behavior for backward compatibility.
- LiteLLM is being added as a separate provider type, not as another backend folder entry.
- The current implementation keeps a single global LiteLLM connection configuration and a single app-managed local proxy runtime.
- The first implementation assumes OpenAI-compatible LiteLLM endpoints for model listing and chat completions.
- LiteLLM templates are chat-only in this initial implementation; the run action opens the in-app LiteLLM chat window instead of a local process.
- Missing remote models and invalid LiteLLM settings are rejected at the IPC boundary before chat is opened.
- The dedicated LiteLLM page now owns install/update checks, local proxy runtime settings, config editing, and the Hexllama connection controls.
- The local manager uses the detected system Python runtime and installs LiteLLM with `python -m pip install litellm[proxy]` semantics.
- Runtime host, port, and log-level edits are rejected while the proxy is running to avoid mismatching the saved local URL and the live process.
- Managed proxy startup waits for a LiteLLM-shaped `/v1/models` response before reporting success.
- The default generated LiteLLM config intentionally omits a master key so a fresh local install works immediately without hidden authorization coupling.