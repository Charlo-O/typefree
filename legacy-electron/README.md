# Legacy Electron Runtime

This directory keeps the pre-Tauri Electron entrypoints for reference only.

TypeFree's active desktop runtime is Tauri v2:

- Development: `npm run tauri:dev`
- Release build: `npm run tauri:build`
- Frontend build: `npm run build`

The files in this directory are not used by default scripts, docs, or CI. They are kept so old
Electron-specific behavior can be inspected while migration work continues. Do not add new runtime
features here; add Tauri commands under `src-tauri/src/commands/` and expose them through
`src/shared/platform`.
