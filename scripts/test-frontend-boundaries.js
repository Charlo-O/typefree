#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");

const migratedHookFacades = new Map([
  ["useAudioRecording.ts", 'export * from "../features/dictation/hooks/useAudioRecording";\n'],
  ["useClipboard.ts", 'export * from "../features/clipboardCenter/hooks/useClipboard";\n'],
  [
    "useClipboardListener.ts",
    'export * from "../features/clipboardCenter/hooks/useClipboardListener";\n',
  ],
  ["useHotkey.ts", 'export * from "../features/hotkeys/hooks/useHotkey";\n'],
  [
    "useHotkeyRegistration.ts",
    [
      'export { default } from "../features/hotkeys/hooks/useHotkeyRegistration";',
      'export * from "../features/hotkeys/hooks/useHotkeyRegistration";',
      "",
    ].join("\n"),
  ],
  ["useLocalModels.ts", 'export * from "../features/settings/hooks/useLocalModels";\n'],
  ["useModelDownload.ts", 'export * from "../features/settings/hooks/useModelDownload";\n'],
  ["usePermissions.ts", 'export * from "../features/settings/hooks/usePermissions";\n'],
  ["useSettings.ts", 'export * from "../features/settings/hooks/useSettings";\n'],
  ["useUpdater.ts", 'export * from "../features/appUpdate/hooks/useUpdater";\n'],
]);

const scanExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".md", ".json"]);
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const nonTypescriptSourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const allowedNonTypescriptSourceFiles = new Set(["src/eslint.config.mjs", "src/vite.config.mjs"]);

function walkFiles(root) {
  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "dist" || entry.name === "node_modules") {
        continue;
      }
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function normalizeText(text) {
  return text.replace(/\r\n/g, "\n");
}

function resolveImport(fromFile, request) {
  if (!request.startsWith(".")) return null;

  const basePath = path.resolve(path.dirname(fromFile), request);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function assertNoElectronApiReferences() {
  const offenders = [];

  for (const file of walkFiles(srcRoot)) {
    if (!scanExtensions.has(path.extname(file))) continue;
    const text = fs.readFileSync(file, "utf8");
    if (text.includes("electronAPI")) {
      offenders.push(relative(file));
    }
  }

  assert.deepEqual(offenders, [], "src must not reference electronAPI compatibility names");
}

function assertNoJsxOrJsSources() {
  const offenders = walkFiles(srcRoot)
    .filter((file) => nonTypescriptSourceExtensions.has(path.extname(file)))
    .map(relative)
    .filter((file) => !allowedNonTypescriptSourceFiles.has(file));

  assert.deepEqual(offenders, [], "src source files should be TypeScript");
}

function assertMigratedHookFacadesAreThin() {
  for (const [filename, expected] of migratedHookFacades) {
    const filePath = path.join(srcRoot, "hooks", filename);
    assert.equal(fs.existsSync(filePath), true, `${relative(filePath)} must exist`);
    assert.equal(normalizeText(fs.readFileSync(filePath, "utf8")), expected, relative(filePath));
  }
}

function assertFeaturesBypassMigratedHookFacades() {
  const forbiddenTargets = new Set(
    [...migratedHookFacades.keys()].map((filename) => path.join(srcRoot, "hooks", filename))
  );
  const roots = [path.join(srcRoot, "features"), path.join(srcRoot, "components")];
  const offenders = [];
  const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;

  for (const root of roots) {
    for (const file of walkFiles(root)) {
      if (!sourceExtensions.has(path.extname(file))) continue;
      const text = fs.readFileSync(file, "utf8");

      for (const match of text.matchAll(importPattern)) {
        const resolved = resolveImport(file, match[1]);
        if (resolved && forbiddenTargets.has(resolved)) {
          offenders.push(`${relative(file)} -> ${match[1]}`);
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "features/components should import migrated business hooks from their feature modules"
  );
}

function assertDesktopRuntimeApiStaysInPlatformBridge() {
  const offenders = [];

  for (const file of walkFiles(srcRoot)) {
    if (!sourceExtensions.has(path.extname(file))) continue;
    const rel = relative(file);
    if (rel.startsWith("src/shared/platform/")) continue;

    const text = fs.readFileSync(file, "utf8");
    if (text.includes("@tauri-apps/api") || /\binvoke\s*\(/.test(text)) {
      offenders.push(rel);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "desktop runtime APIs should be wrapped by src/shared/platform before UI/features/services use them"
  );
}

const tests = [
  ["has no electronAPI references in src", assertNoElectronApiReferences],
  [
    "keeps desktop runtime API access inside the platform bridge",
    assertDesktopRuntimeApiStaysInPlatformBridge,
  ],
  ["keeps src source files in TypeScript", assertNoJsxOrJsSources],
  ["keeps migrated top-level hooks as thin facades", assertMigratedHookFacadesAreThin],
  ["keeps features/components off migrated hook facades", assertFeaturesBypassMigratedHookFacades],
];

let failures = 0;

for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exit(1);
}

console.log(`frontend boundary tests passed (${tests.length})`);
