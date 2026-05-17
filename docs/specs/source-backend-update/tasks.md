# Source Backend Update Tasks

- DONE: Add a Windows source-build helper script for updating and compiling llama.cpp into a versioned build folder.
- DONE: Replace the main-process release download handler with a source-build update handler and template migration logic.
- DONE: Expose the source update API through preload and renderer typings.
- DONE: Update Settings and the update banner to trigger the source-build flow and refresh state on success.
- DONE: Validate with `npm run build` and update handoff notes.
