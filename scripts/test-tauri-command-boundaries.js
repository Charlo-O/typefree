#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const commandsRoot = path.join(repoRoot, "src-tauri", "src", "commands");

function walkRustFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRustFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".rs")) {
      files.push(fullPath);
    }
  }
  return files;
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function collectCommandSignatures(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").split("\n");
  const signatures = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("#[tauri::command]")) continue;

    let functionStart = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*pub(?:\s+async)?\s+fn\s+\w+/.test(lines[cursor])) {
        functionStart = cursor;
        break;
      }

      if (lines[cursor].includes("#[tauri::command]")) {
        break;
      }
    }

    assert.notEqual(functionStart, -1, `${relative(filePath)}:${index + 1} command missing pub fn`);

    const signatureLines = [];
    for (let cursor = functionStart; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      signatureLines.push(line.trim());
      if (line.includes("{")) break;
    }

    const signature = signatureLines.join(" ");
    const name = signature.match(/\bfn\s+([A-Za-z0-9_]+)/)?.[1] || "<unknown>";
    signatures.push({
      file: relative(filePath),
      line: functionStart + 1,
      name,
      signature,
    });
  }

  return signatures;
}

function returnsRawResult(signature) {
  return /(^|[^\w:])Result\s*</.test(signature) || /std::result::Result\s*</.test(signature);
}

const commandSignatures = walkRustFiles(commandsRoot).flatMap(collectCommandSignatures);
const dictationSource = fs.readFileSync(
  path.join(commandsRoot, "dictation.rs"),
  "utf8"
);

const rawResultCommands = commandSignatures
  .filter(({ signature }) => returnsRawResult(signature))
  .map(({ file, line, name, signature }) => `${file}:${line} ${name} => ${signature}`);

const commandResultCommands = commandSignatures.filter(({ signature }) =>
  signature.includes("CommandResult")
);

assert.equal(commandSignatures.length > 0, true, "expected to find Tauri command functions");
assert.deepEqual(
  rawResultCommands,
  [],
  "Tauri commands must return CommandResult for typed errors"
);
assert.equal(
  commandResultCommands.length > 0,
  true,
  "expected at least one Tauri command to use CommandResult"
);
assert.equal(
  /let\s+_\s*=\s*super::database::db_save_transcription_record_value/.test(dictationSource),
  false,
  "backend dictation must not ignore history/session save failures"
);
assert.match(
  dictationSource,
  /Dictation history save failed/,
  "backend dictation should emit a clear history save failure"
);
const backendPasteIndex = dictationSource.indexOf("super::clipboard::paste_text");
const backendHistorySaveIndex = dictationSource.indexOf(
  "super::database::db_save_transcription_record_value"
);
assert.notEqual(backendPasteIndex, -1, "backend dictation should paste text explicitly");
assert.notEqual(
  backendHistorySaveIndex,
  -1,
  "backend dictation should save history/session explicitly"
);
assert.equal(
  backendPasteIndex < backendHistorySaveIndex,
  true,
  "backend dictation should follow completion pipeline order: insert before history save"
);

console.log(`tauri command boundary tests passed (${commandSignatures.length} commands)`);
