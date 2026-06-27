export interface VocabularySnippet {
  trigger: string;
  replacement: string;
}

export type VocabularyLayerScope = "global" | "profile" | "application" | "contextPack";
export type VocabularyScopedLayerScope = Extract<VocabularyLayerScope, "profile" | "application">;

interface VocabularyLayerEntryBase {
  id: string;
  scope: VocabularyLayerScope;
  enabled: boolean;
  createdAt: string;
  profileId?: string | null;
  applicationId?: string | null;
  contextPackId?: string | null;
}

export interface VocabularyHotwordEntry extends VocabularyLayerEntryBase {
  word: string;
}

export interface VocabularySnippetEntry extends VocabularyLayerEntryBase, VocabularySnippet {}

export interface VocabularyContextPack {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
}

export interface VocabularyLayers {
  schemaVersion: 1;
  hotwords: VocabularyHotwordEntry[];
  snippets: VocabularySnippetEntry[];
  contextPacks: VocabularyContextPack[];
  activeContextPackIds: string[];
  activeProfileId: string | null;
  activeApplicationId: string | null;
}

export interface VocabularyLayerSummary {
  globalHotwords: number;
  globalSnippets: number;
  profileEntries: number;
  applicationEntries: number;
  contextPackEntries: number;
  contextPacks: number;
  activeContextPacks: number;
}

interface NormalizeVocabularyLayersOptions {
  reconcileGlobalHotwords?: boolean;
  reconcileGlobalSnippets?: boolean;
}

const EMPTY_LAYERS: VocabularyLayers = {
  schemaVersion: 1,
  hotwords: [],
  snippets: [],
  contextPacks: [],
  activeContextPackIds: [],
  activeProfileId: null,
  activeApplicationId: null,
};

function cleanText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeKey(value: string): string {
  return value.replace(/\s+/g, "").toLocaleLowerCase();
}

function createStableId(parts: string[]): string {
  return parts
    .map((part) =>
      cleanText(part)
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
    )
    .filter(Boolean)
    .join(":")
    .slice(0, 180);
}

function createUniqueId(parts: string[], existingIds: Set<string>, fallbackPrefix: string): string {
  const stableId = createStableId(parts);
  const baseId =
    stableId ||
    `${fallbackPrefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

  if (!existingIds.has(baseId)) return baseId;

  let index = 2;
  while (existingIds.has(`${baseId}:${index}`)) {
    index += 1;
  }
  return `${baseId}:${index}`;
}

function uniqueCleanTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = cleanText(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }

  return result;
}

function normalizeScope(value: unknown): VocabularyLayerScope {
  return value === "profile" || value === "application" || value === "contextPack"
    ? value
    : "global";
}

function normalizeContextPack(value: any): VocabularyContextPack | null {
  const name = cleanText(value?.name);
  const id = cleanText(value?.id) || createStableId(["context-pack", name]);
  if (!id || !name) return null;

  return {
    id,
    name,
    enabled: value?.enabled !== false,
    createdAt: cleanText(value?.createdAt) || new Date().toISOString(),
  };
}

function normalizeHotwordEntry(value: any): VocabularyHotwordEntry | null {
  const word = cleanText(value?.word);
  if (!word) return null;

  const scope = normalizeScope(value?.scope);
  const profileId = cleanText(value?.profileId) || null;
  const applicationId = cleanText(value?.applicationId) || null;
  const contextPackId = cleanText(value?.contextPackId) || null;

  return {
    id:
      cleanText(value?.id) ||
      createStableId([
        "hotword",
        scope,
        profileId || "",
        applicationId || "",
        contextPackId || "",
        word,
      ]),
    word,
    scope,
    enabled: value?.enabled !== false,
    createdAt: cleanText(value?.createdAt) || new Date().toISOString(),
    profileId,
    applicationId,
    contextPackId,
  };
}

function normalizeSnippetEntry(value: any): VocabularySnippetEntry | null {
  const trigger = cleanText(value?.trigger);
  const replacement = cleanText(value?.replacement);
  if (!trigger || !replacement || normalizeKey(trigger) === normalizeKey(replacement)) {
    return null;
  }

  const scope = normalizeScope(value?.scope);
  const profileId = cleanText(value?.profileId) || null;
  const applicationId = cleanText(value?.applicationId) || null;
  const contextPackId = cleanText(value?.contextPackId) || null;

  return {
    id:
      cleanText(value?.id) ||
      createStableId([
        "snippet",
        scope,
        profileId || "",
        applicationId || "",
        contextPackId || "",
        trigger,
        replacement,
      ]),
    trigger,
    replacement,
    scope,
    enabled: value?.enabled !== false,
    createdAt: cleanText(value?.createdAt) || new Date().toISOString(),
    profileId,
    applicationId,
    contextPackId,
  };
}

function dedupeHotwordEntries(entries: VocabularyHotwordEntry[]): VocabularyHotwordEntry[] {
  const seen = new Set<string>();
  const result: VocabularyHotwordEntry[] = [];

  for (const entry of entries) {
    const key = [
      entry.scope,
      entry.profileId || "",
      entry.applicationId || "",
      entry.contextPackId || "",
      entry.word.toLocaleLowerCase(),
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }

  return result;
}

function dedupeSnippetEntries(entries: VocabularySnippetEntry[]): VocabularySnippetEntry[] {
  const seen = new Set<string>();
  const result: VocabularySnippetEntry[] = [];

  for (const entry of entries) {
    const key = [
      entry.scope,
      entry.profileId || "",
      entry.applicationId || "",
      entry.contextPackId || "",
      normalizeKey(entry.trigger),
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }

  return result;
}

function createGlobalHotwordEntry(
  word: string,
  previous?: VocabularyHotwordEntry
): VocabularyHotwordEntry {
  return {
    id: previous?.id || createStableId(["hotword", "global", word]),
    word,
    scope: "global",
    enabled: true,
    createdAt: previous?.createdAt || new Date().toISOString(),
    profileId: null,
    applicationId: null,
    contextPackId: null,
  };
}

function createGlobalSnippetEntry(
  snippet: VocabularySnippet,
  previous?: VocabularySnippetEntry
): VocabularySnippetEntry {
  return {
    id: previous?.id || createStableId(["snippet", "global", snippet.trigger, snippet.replacement]),
    trigger: snippet.trigger,
    replacement: snippet.replacement,
    scope: "global",
    enabled: true,
    createdAt: previous?.createdAt || new Date().toISOString(),
    profileId: null,
    applicationId: null,
    contextPackId: null,
  };
}

export function normalizeVocabularyLayers(
  value: unknown,
  legacyHotwords: string[],
  legacySnippets: VocabularySnippet[],
  options: NormalizeVocabularyLayersOptions = {}
): VocabularyLayers {
  const raw = value && typeof value === "object" ? (value as Partial<VocabularyLayers>) : {};
  const previousHotwords = Array.isArray(raw.hotwords)
    ? raw.hotwords
        .map(normalizeHotwordEntry)
        .filter((entry): entry is VocabularyHotwordEntry => !!entry)
    : [];
  const previousSnippets = Array.isArray(raw.snippets)
    ? raw.snippets
        .map(normalizeSnippetEntry)
        .filter((entry): entry is VocabularySnippetEntry => !!entry)
    : [];
  const contextPacks = Array.isArray(raw.contextPacks)
    ? raw.contextPacks
        .map(normalizeContextPack)
        .filter((pack): pack is VocabularyContextPack => !!pack)
    : [];
  const contextPackIds = new Set(contextPacks.map((pack) => pack.id));
  const previousGlobalHotwords = new Map(
    previousHotwords
      .filter((entry) => entry.scope === "global")
      .map((entry) => [entry.word.toLocaleLowerCase(), entry])
  );
  const previousGlobalSnippets = new Map(
    previousSnippets
      .filter((entry) => entry.scope === "global")
      .map((entry) => [normalizeKey(entry.trigger), entry])
  );

  const shouldReconcileGlobalHotwords = options.reconcileGlobalHotwords !== false;
  const shouldReconcileGlobalSnippets = options.reconcileGlobalSnippets !== false;
  const globalHotwords = shouldReconcileGlobalHotwords
    ? legacyHotwords.map((word) =>
        createGlobalHotwordEntry(word, previousGlobalHotwords.get(word.toLocaleLowerCase()))
      )
    : previousHotwords.filter((entry) => entry.scope === "global");
  const globalSnippets = shouldReconcileGlobalSnippets
    ? legacySnippets.map((snippet) =>
        createGlobalSnippetEntry(snippet, previousGlobalSnippets.get(normalizeKey(snippet.trigger)))
      )
    : previousSnippets.filter((entry) => entry.scope === "global");

  return {
    schemaVersion: 1,
    hotwords: dedupeHotwordEntries([
      ...globalHotwords,
      ...previousHotwords.filter((entry) => entry.scope !== "global"),
    ]),
    snippets: dedupeSnippetEntries([
      ...globalSnippets,
      ...previousSnippets.filter((entry) => entry.scope !== "global"),
    ]),
    contextPacks,
    activeContextPackIds: Array.isArray(raw.activeContextPackIds)
      ? uniqueCleanTexts(raw.activeContextPackIds.map(cleanText)).filter((id) =>
          contextPackIds.has(id)
        )
      : [],
    activeProfileId: cleanText(raw.activeProfileId) || null,
    activeApplicationId: cleanText(raw.activeApplicationId) || null,
  };
}

export function getGlobalHotwords(layers: VocabularyLayers = EMPTY_LAYERS): string[] {
  return layers.hotwords.filter((entry) => entry.scope === "global").map((entry) => entry.word);
}

export function getGlobalSnippets(layers: VocabularyLayers = EMPTY_LAYERS): VocabularySnippet[] {
  return layers.snippets
    .filter((entry) => entry.scope === "global")
    .map(({ trigger, replacement }) => ({ trigger, replacement }));
}

function isContextPackActive(layers: VocabularyLayers, entry: { contextPackId?: string | null }) {
  if (!entry.contextPackId || !layers.activeContextPackIds.includes(entry.contextPackId)) {
    return false;
  }

  const pack = layers.contextPacks.find((candidate) => candidate.id === entry.contextPackId);
  return pack?.enabled !== false;
}

function isEntryActive(layers: VocabularyLayers, entry: VocabularyLayerEntryBase): boolean {
  if (!entry.enabled) return false;
  if (entry.scope === "global") return true;
  if (entry.scope === "profile")
    return !!entry.profileId && entry.profileId === layers.activeProfileId;
  if (entry.scope === "application") {
    return !!entry.applicationId && entry.applicationId === layers.activeApplicationId;
  }
  return isContextPackActive(layers, entry);
}

export function getActiveLayerHotwords(layers: VocabularyLayers): string[] {
  return layers.hotwords.filter((entry) => isEntryActive(layers, entry)).map((entry) => entry.word);
}

export function getActiveLayerSnippets(layers: VocabularyLayers): VocabularySnippet[] {
  return layers.snippets
    .filter((entry) => isEntryActive(layers, entry))
    .map(({ trigger, replacement }) => ({ trigger, replacement }));
}

export function getVocabularyLayerSummary(layers: VocabularyLayers): VocabularyLayerSummary {
  const scopedEntries = [...layers.hotwords, ...layers.snippets];
  return {
    globalHotwords: layers.hotwords.filter((entry) => entry.scope === "global").length,
    globalSnippets: layers.snippets.filter((entry) => entry.scope === "global").length,
    profileEntries: scopedEntries.filter((entry) => entry.scope === "profile").length,
    applicationEntries: scopedEntries.filter((entry) => entry.scope === "application").length,
    contextPackEntries: scopedEntries.filter((entry) => entry.scope === "contextPack").length,
    contextPacks: layers.contextPacks.length,
    activeContextPacks: layers.contextPacks.filter(
      (pack) => pack.enabled && layers.activeContextPackIds.includes(pack.id)
    ).length,
  };
}

function getScopeIdField(scope: VocabularyScopedLayerScope): "profileId" | "applicationId" {
  return scope === "profile" ? "profileId" : "applicationId";
}

function getActiveScopeId(layers: VocabularyLayers, scope: VocabularyScopedLayerScope): string {
  return scope === "profile" ? layers.activeProfileId || "" : layers.activeApplicationId || "";
}

export function setVocabularyActiveProfile(
  layers: VocabularyLayers,
  profileId: string
): VocabularyLayers {
  return {
    ...layers,
    activeProfileId: cleanText(profileId) || null,
  };
}

export function setVocabularyActiveApplication(
  layers: VocabularyLayers,
  applicationId: string
): VocabularyLayers {
  return {
    ...layers,
    activeApplicationId: cleanText(applicationId) || null,
  };
}

export function addVocabularyScopedHotword(
  layers: VocabularyLayers,
  scope: VocabularyScopedLayerScope,
  scopeId: string,
  word: string
): VocabularyLayers {
  const cleanedScopeId = cleanText(scopeId);
  const cleanedWord = cleanText(word);
  if (!cleanedScopeId || !cleanedWord) return layers;

  const scopeIdField = getScopeIdField(scope);
  const existingIds = new Set(layers.hotwords.map((entry) => entry.id));
  const entry: VocabularyHotwordEntry = {
    id: createUniqueId(["hotword", scope, cleanedScopeId, cleanedWord], existingIds, "hotword"),
    word: cleanedWord,
    scope,
    enabled: true,
    createdAt: new Date().toISOString(),
    profileId: scope === "profile" ? cleanedScopeId : null,
    applicationId: scope === "application" ? cleanedScopeId : null,
    contextPackId: null,
  };

  return {
    ...layers,
    [scope === "profile" ? "activeProfileId" : "activeApplicationId"]: getActiveScopeId(
      layers,
      scope
    )
      ? getActiveScopeId(layers, scope)
      : cleanedScopeId,
    hotwords: dedupeHotwordEntries([
      ...layers.hotwords,
      {
        ...entry,
        [scopeIdField]: cleanedScopeId,
      },
    ]),
  };
}

export function addVocabularyScopedSnippet(
  layers: VocabularyLayers,
  scope: VocabularyScopedLayerScope,
  scopeId: string,
  snippet: VocabularySnippet
): VocabularyLayers {
  const cleanedScopeId = cleanText(scopeId);
  const trigger = cleanText(snippet.trigger);
  const replacement = cleanText(snippet.replacement);
  if (
    !cleanedScopeId ||
    !trigger ||
    !replacement ||
    normalizeKey(trigger) === normalizeKey(replacement)
  ) {
    return layers;
  }

  const scopeIdField = getScopeIdField(scope);
  const existingIds = new Set(layers.snippets.map((entry) => entry.id));
  const entry: VocabularySnippetEntry = {
    id: createUniqueId(
      ["snippet", scope, cleanedScopeId, trigger, replacement],
      existingIds,
      "snippet"
    ),
    trigger,
    replacement,
    scope,
    enabled: true,
    createdAt: new Date().toISOString(),
    profileId: scope === "profile" ? cleanedScopeId : null,
    applicationId: scope === "application" ? cleanedScopeId : null,
    contextPackId: null,
  };

  return {
    ...layers,
    [scope === "profile" ? "activeProfileId" : "activeApplicationId"]: getActiveScopeId(
      layers,
      scope
    )
      ? getActiveScopeId(layers, scope)
      : cleanedScopeId,
    snippets: dedupeSnippetEntries([
      ...layers.snippets,
      {
        ...entry,
        [scopeIdField]: cleanedScopeId,
      },
    ]),
  };
}

export function removeVocabularyScopedHotword(
  layers: VocabularyLayers,
  scope: VocabularyScopedLayerScope,
  entryId: string
): VocabularyLayers {
  const id = cleanText(entryId);
  if (!id) return layers;

  return {
    ...layers,
    hotwords: layers.hotwords.filter((entry) => entry.id !== id || entry.scope !== scope),
  };
}

export function removeVocabularyScopedSnippet(
  layers: VocabularyLayers,
  scope: VocabularyScopedLayerScope,
  entryId: string
): VocabularyLayers {
  const id = cleanText(entryId);
  if (!id) return layers;

  return {
    ...layers,
    snippets: layers.snippets.filter((entry) => entry.id !== id || entry.scope !== scope),
  };
}

export function createVocabularyContextPack(
  layers: VocabularyLayers,
  name: string
): { layers: VocabularyLayers; pack: VocabularyContextPack | null } {
  const cleanedName = cleanText(name);
  if (!cleanedName) return { layers, pack: null };

  const existingPack = layers.contextPacks.find(
    (pack) => normalizeKey(pack.name) === normalizeKey(cleanedName)
  );
  if (existingPack) {
    const nextLayers = setVocabularyContextPackActive(
      setVocabularyContextPackEnabled(layers, existingPack.id, true),
      existingPack.id,
      true
    );
    return {
      layers: nextLayers,
      pack: nextLayers.contextPacks.find((pack) => pack.id === existingPack.id) || existingPack,
    };
  }

  const existingIds = new Set(layers.contextPacks.map((pack) => pack.id));
  const pack: VocabularyContextPack = {
    id: createUniqueId(["context-pack", cleanedName], existingIds, "context-pack"),
    name: cleanedName,
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  return {
    layers: {
      ...layers,
      contextPacks: [...layers.contextPacks, pack],
      activeContextPackIds: uniqueCleanTexts([...layers.activeContextPackIds, pack.id]),
    },
    pack,
  };
}

export function setVocabularyContextPackEnabled(
  layers: VocabularyLayers,
  contextPackId: string,
  enabled: boolean
): VocabularyLayers {
  const packId = cleanText(contextPackId);
  if (!packId || !layers.contextPacks.some((pack) => pack.id === packId)) return layers;

  return {
    ...layers,
    contextPacks: layers.contextPacks.map((pack) =>
      pack.id === packId ? { ...pack, enabled } : pack
    ),
    activeContextPackIds: enabled
      ? layers.activeContextPackIds
      : layers.activeContextPackIds.filter((id) => id !== packId),
  };
}

export function setVocabularyContextPackActive(
  layers: VocabularyLayers,
  contextPackId: string,
  active: boolean
): VocabularyLayers {
  const packId = cleanText(contextPackId);
  if (!packId || !layers.contextPacks.some((pack) => pack.id === packId)) return layers;

  return {
    ...layers,
    contextPacks: active
      ? layers.contextPacks.map((pack) => (pack.id === packId ? { ...pack, enabled: true } : pack))
      : layers.contextPacks,
    activeContextPackIds: active
      ? uniqueCleanTexts([...layers.activeContextPackIds, packId])
      : layers.activeContextPackIds.filter((id) => id !== packId),
  };
}

export function removeVocabularyContextPack(
  layers: VocabularyLayers,
  contextPackId: string
): VocabularyLayers {
  const packId = cleanText(contextPackId);
  if (!packId) return layers;

  return {
    ...layers,
    contextPacks: layers.contextPacks.filter((pack) => pack.id !== packId),
    activeContextPackIds: layers.activeContextPackIds.filter((id) => id !== packId),
    hotwords: layers.hotwords.filter((entry) => entry.contextPackId !== packId),
    snippets: layers.snippets.filter((entry) => entry.contextPackId !== packId),
  };
}

export function addVocabularyContextPackHotword(
  layers: VocabularyLayers,
  contextPackId: string,
  word: string
): VocabularyLayers {
  const packId = cleanText(contextPackId);
  const cleanedWord = cleanText(word);
  if (!packId || !cleanedWord || !layers.contextPacks.some((pack) => pack.id === packId)) {
    return layers;
  }

  const existingIds = new Set(layers.hotwords.map((entry) => entry.id));
  const entry: VocabularyHotwordEntry = {
    id: createUniqueId(["hotword", "context-pack", packId, cleanedWord], existingIds, "hotword"),
    word: cleanedWord,
    scope: "contextPack",
    enabled: true,
    createdAt: new Date().toISOString(),
    profileId: null,
    applicationId: null,
    contextPackId: packId,
  };

  return {
    ...layers,
    hotwords: dedupeHotwordEntries([...layers.hotwords, entry]),
  };
}

export function addVocabularyContextPackSnippet(
  layers: VocabularyLayers,
  contextPackId: string,
  snippet: VocabularySnippet
): VocabularyLayers {
  const packId = cleanText(contextPackId);
  const trigger = cleanText(snippet.trigger);
  const replacement = cleanText(snippet.replacement);
  if (
    !packId ||
    !trigger ||
    !replacement ||
    normalizeKey(trigger) === normalizeKey(replacement) ||
    !layers.contextPacks.some((pack) => pack.id === packId)
  ) {
    return layers;
  }

  const existingIds = new Set(layers.snippets.map((entry) => entry.id));
  const entry: VocabularySnippetEntry = {
    id: createUniqueId(
      ["snippet", "context-pack", packId, trigger, replacement],
      existingIds,
      "snippet"
    ),
    trigger,
    replacement,
    scope: "contextPack",
    enabled: true,
    createdAt: new Date().toISOString(),
    profileId: null,
    applicationId: null,
    contextPackId: packId,
  };

  return {
    ...layers,
    snippets: dedupeSnippetEntries([...layers.snippets, entry]),
  };
}

export function removeVocabularyContextPackHotword(
  layers: VocabularyLayers,
  entryId: string
): VocabularyLayers {
  const id = cleanText(entryId);
  if (!id) return layers;

  return {
    ...layers,
    hotwords: layers.hotwords.filter((entry) => entry.id !== id || entry.scope !== "contextPack"),
  };
}

export function removeVocabularyContextPackSnippet(
  layers: VocabularyLayers,
  entryId: string
): VocabularyLayers {
  const id = cleanText(entryId);
  if (!id) return layers;

  return {
    ...layers,
    snippets: layers.snippets.filter((entry) => entry.id !== id || entry.scope !== "contextPack"),
  };
}
