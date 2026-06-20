# TypeFree Landing Site

This folder is the standalone static landing page deployed by GitHub Pages.
It is intentionally kept outside `src/` so Vite and Tauri do not copy these
assets into the desktop app bundle.

Desktop releases build from `src/dist`; this folder is published directly by
`.github/workflows/pages.yml` and is excluded from release source archives with
`.gitattributes`.

