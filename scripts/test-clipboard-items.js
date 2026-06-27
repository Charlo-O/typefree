#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const compiledRoot = fs.mkdtempSync(path.join(os.tmpdir(), "typefree-clipboard-tests-"));

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "../../shared/platform/clipboardCommands") {
    return {
      resolveFileAssetSrc: (source) => `asset://${source}`,
    };
  }
  if (request === "@tauri-apps/api/core") {
    return {
      convertFileSrc: (source) => `asset://${source}`,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function compileSourceFile(relativePath) {
  const filename = path.join(srcRoot, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const diagnostics = (output.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (diagnostics.length > 0) {
    const message = diagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join("\n");
    throw new Error(`Failed to transpile ${filename}:\n${message}`);
  }

  const outputPath = path.join(compiledRoot, relativePath).replace(/\.tsx?$/, ".js");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output.outputText, "utf8");
  return outputPath;
}

const clipboardItems = require(compileSourceFile("features/clipboardCenter/clipboardItems.ts"));
const privacySettings = require(compileSourceFile("features/privacy/privacySettings.ts"));
const clipboardRetention = require(
  compileSourceFile("features/clipboardCenter/clipboardRetention.ts")
);

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

async function run() {
  const inlineItem = {
    id: "legacy-image",
    type: "image",
    content: "data:image/png;base64,aGVsbG8=",
    tsMs: 123,
  };
  const fileBackedItem = {
    id: "file-image",
    type: "image",
    content: "C:/app/clipboard-images/thumbs/file.png",
    blobPath: "C:/app/clipboard-images/file.png",
    thumbPath: "C:/app/clipboard-images/thumbs/file.png",
    tsMs: 456,
  };

  assert.equal(clipboardItems.isInlineClipboardImageItem(inlineItem), true);
  assert.equal(clipboardItems.isInlineClipboardImageItem(fileBackedItem), false);
  assert.equal(
    clipboardItems.resolveClipboardImageSrc(fileBackedItem),
    "asset://C:/app/clipboard-images/thumbs/file.png"
  );
  assert.equal(clipboardItems.clipboardImagePasteSource(fileBackedItem), fileBackedItem.blobPath);

  const migrated = await clipboardItems.migrateInlineClipboardImageItems(
    [inlineItem, fileBackedItem],
    async (source, id, tsMs) => ({
      id,
      type: "image",
      content: "C:/app/clipboard-images/thumbs/legacy.png",
      blobPath: "C:/app/clipboard-images/legacy.png",
      thumbPath: "C:/app/clipboard-images/thumbs/legacy.png",
      tsMs,
      metadata: { width: 10, height: 20, byteSize: 30, mimeType: "image/png" },
      source,
    })
  );

  assert.equal(migrated.changed, true);
  assert.equal(migrated.items[0].id, inlineItem.id);
  assert.equal(migrated.items[0].content, "C:/app/clipboard-images/thumbs/legacy.png");
  assert.equal(migrated.items[0].blobPath, "C:/app/clipboard-images/legacy.png");
  assert.equal(migrated.items[0].metadata.width, 10);
  assert.equal(migrated.items[1], fileBackedItem);

  const unused = clipboardItems.collectUnusedClipboardImagePaths(
    [fileBackedItem],
    [
      {
        ...fileBackedItem,
        content: "C:/app/clipboard-images/thumbs/other.png",
        blobPath: "C:/app/clipboard-images/other.png",
        thumbPath: "C:/app/clipboard-images/thumbs/other.png",
      },
    ]
  );
  assert.deepEqual(unused.sort(), [
    "C:/app/clipboard-images/file.png",
    "C:/app/clipboard-images/thumbs/file.png",
  ]);

  const favoriteProtectedOldImage = {
    id: "favorite-protected-old-image",
    type: "image",
    content: "C:/app/clipboard-images/thumbs/protected.png",
    blobPath: "C:/app/clipboard-images/protected.png",
    thumbPath: "C:/app/clipboard-images/thumbs/protected.png",
    tsMs: Date.UTC(2026, 0, 1),
  };
  const unusedOldImage = {
    id: "unused-old-image",
    type: "image",
    content: "C:/app/clipboard-images/thumbs/unused.png",
    blobPath: "C:/app/clipboard-images/unused.png",
    thumbPath: "C:/app/clipboard-images/thumbs/unused.png",
    tsMs: Date.UTC(2026, 0, 2),
  };
  const retainedImage = {
    id: "retained-image",
    type: "image",
    content: "C:/app/clipboard-images/thumbs/retained.png",
    blobPath: "C:/app/clipboard-images/retained.png",
    thumbPath: "C:/app/clipboard-images/thumbs/retained.png",
    tsMs: Date.UTC(2026, 0, 30),
  };
  const privacyStorage = createMemoryStorage({
    [privacySettings.PRIVACY_AUTO_DELETE_HISTORY_KEY]: "true",
    [privacySettings.PRIVACY_HISTORY_RETENTION_DAYS_KEY]: "7",
    [clipboardItems.CLIPBOARD_STORAGE_KEYS.history]: JSON.stringify([
      favoriteProtectedOldImage,
      unusedOldImage,
      retainedImage,
    ]),
    [clipboardItems.CLIPBOARD_STORAGE_KEYS.favorites]: JSON.stringify({
      items: [favoriteProtectedOldImage],
    }),
  });

  const deletedPaths = [];
  const pruned = clipboardRetention.pruneStoredClipboardHistoryWithImageCleanup({
    storage: privacyStorage,
    nowMs: Date.UTC(2026, 0, 31),
    deleteImageFiles: (paths) => deletedPaths.push(...paths),
  });
  assert.deepEqual(pruned.removed.map((item) => item.id).sort(), [
    "favorite-protected-old-image",
    "unused-old-image",
  ]);
  assert.deepEqual(
    pruned.retained.map((item) => item.id),
    ["retained-image"]
  );
  assert.deepEqual(
    JSON.parse(privacyStorage.getItem(clipboardItems.CLIPBOARD_STORAGE_KEYS.history)).map(
      (item) => item.id
    ),
    ["retained-image"]
  );

  const favoriteState = JSON.parse(
    privacyStorage.getItem(clipboardItems.CLIPBOARD_STORAGE_KEYS.favorites)
  );
  const retainedReferences = [...pruned.retained, ...favoriteState.items];
  const expectedDeletedPaths = [
    "C:/app/clipboard-images/thumbs/unused.png",
    "C:/app/clipboard-images/unused.png",
  ].sort();
  assert.deepEqual(
    clipboardItems.collectUnusedClipboardImagePaths(pruned.removed, retainedReferences).sort(),
    expectedDeletedPaths
  );
  assert.deepEqual(pruned.unusedImagePaths.sort(), expectedDeletedPaths);
  assert.deepEqual(
    deletedPaths.sort(),
    ["C:/app/clipboard-images/thumbs/unused.png", "C:/app/clipboard-images/unused.png"].sort()
  );

  assert.equal(typeof privacySettings.pruneStoredClipboardHistoryWithResult, "function");

  console.log("clipboard item tests passed (2)");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
