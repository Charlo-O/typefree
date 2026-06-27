#!/usr/bin/env bash
set -euo pipefail

TARGET_ROOT="${1:-src-tauri/target}"

if [[ ! -d "${TARGET_ROOT}" ]]; then
  echo "macOS artifact root does not exist: ${TARGET_ROOT}" >&2
  exit 1
fi

mapfile -d '' apps < <(find "${TARGET_ROOT}" -type d -name "*.app" -print0)

if (( ${#apps[@]} == 0 )); then
  echo "No generated .app bundle found under ${TARGET_ROOT}" >&2
  exit 1
fi

for app in "${apps[@]}"; do
  echo "Verifying signed app bundle: ${app}"
  codesign --verify --deep --strict --verbose=2 "${app}"
  spctl --assess --type execute --verbose=4 "${app}"
  xcrun stapler validate "${app}"
done

mapfile -d '' dmgs < <(find "${TARGET_ROOT}" -type f -name "*.dmg" -print0)

if (( ${#dmgs[@]} == 0 )); then
  echo "No generated .dmg artifact found under ${TARGET_ROOT}; app bundle verification passed."
  exit 0
fi

for dmg in "${dmgs[@]}"; do
  echo "Verifying signed disk image: ${dmg}"
  spctl --assess --type open --context context:primary-signature --verbose=4 "${dmg}"
  xcrun stapler validate "${dmg}"
done
