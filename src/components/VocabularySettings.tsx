import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock,
  Edit3,
  ListChecks,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Toggle } from "./ui/toggle";
import {
  DEFAULT_HOTWORDS,
  DEFAULT_SNIPPETS,
  getEffectiveHotwords,
  getEffectiveSnippets,
  loadVocabularySettings,
  saveVocabularySettings,
  type SnippetReplacement,
  type VocabularySettings as VocabularySettingsData,
} from "../utils/vocabulary";
import { useI18n, type TFunction } from "../i18n";

type SortMode = "time" | "alpha";
type DialogMode = "quick" | "smart" | "hotwords" | "snippets" | null;

interface SnippetGroup {
  replacement: string;
  triggers: string[];
}

interface HistoryRecord {
  id: number | string;
  text: string;
  timestamp?: string;
}

interface VariantSuggestion {
  id: string;
  trigger: string;
  replacement: string;
  isSelected: boolean;
  isDuplicate: boolean;
}

interface HotwordSuggestion {
  id: string;
  word: string;
  isSelected: boolean;
  isDuplicate: boolean;
}

interface GenerationResult {
  snippets: VariantSuggestion[];
  hotwords: HotwordSuggestion[];
  hotwordReason: string;
}

const EMPTY_SETTINGS: VocabularySettingsData = {
  hotwordsEnabled: true,
  snippetsEnabled: true,
  userHotwords: [],
  userSnippets: [],
};

const TECH_VARIANTS: Record<string, string[]> = {
  "claude": ["cloud", "clod", "clawed", "claud"],
  "claude code": ["cloud code", "clod code", "claude coat", "cloud coat"],
  "deepseek": ["deep seek", "deep sick", "deep sec", "deepse"],
  "qwen": ["queen", "quin", "qun"],
  "qwen3": ["queen 3", "queen three", "queen3", "qun 3"],
  "qwen3.5": ["queen 3.5", "queen three point five", "qwen 3.5"],
  "grok": ["grock"],
  "groq": ["grok"],
  "gemini": ["jiminy", "gem any"],
  "github": ["git hub", "get hub"],
  "typescript": ["type script", "typepescript"],
  "javascript": ["java script"],
  "postgresql": ["post gray sql", "postgre sql"],
  "supabase": ["super base"],
  "websocket": ["web socket"],
  "hugging face": ["hugging phase", "hug and face"],
  "midjourney": ["mid journey"],
  "copilot": ["co pilot"],
  "cursor": ["curser"],
  "windsurf": ["wind surf"],
  "codex": ["codecs", "codec", "code x"],
  "vibe coding": ["web coding", "webb coding", "vibes coding", "wife coding"],
};

const COMMON_WORDS = new Set([
  "the",
  "and",
  "that",
  "this",
  "with",
  "for",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "can",
  "will",
  "not",
  "what",
  "why",
  "how",
  "when",
  "where",
]);

function snippetKey(value: string): string {
  return value.replace(/\s+/g, "").toLocaleLowerCase();
}

function hotwordKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function cleanText(value: unknown): string {
  return String(value || "").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    const key = hotwordKey(cleaned);
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function uniqueSnippets(snippets: SnippetReplacement[]): SnippetReplacement[] {
  const byTrigger = new Map<string, SnippetReplacement>();
  for (const snippet of snippets) {
    const trigger = cleanText(snippet.trigger);
    const replacement = cleanText(snippet.replacement);
    if (!trigger || !replacement || snippetKey(trigger) === snippetKey(replacement)) continue;
    byTrigger.set(snippetKey(trigger), { trigger, replacement });
  }
  return Array.from(byTrigger.values());
}

function groupSnippets(snippets: SnippetReplacement[]): SnippetGroup[] {
  const order: string[] = [];
  const grouped = new Map<string, string[]>();

  for (const snippet of snippets) {
    const replacement = cleanText(snippet.replacement);
    const trigger = cleanText(snippet.trigger);
    if (!replacement || !trigger) continue;
    if (!grouped.has(replacement)) {
      grouped.set(replacement, []);
      order.push(replacement);
    }
    grouped.get(replacement)?.push(trigger);
  }

  return order.map((replacement) => ({
    replacement,
    triggers: grouped.get(replacement) || [],
  }));
}

function sortGroups(groups: SnippetGroup[], sortMode: SortMode): SnippetGroup[] {
  if (sortMode === "time") return groups;
  return [...groups].sort((a, b) =>
    a.replacement.localeCompare(b.replacement, undefined, { sensitivity: "base" })
  );
}

function parseBulkHotwords(text: string): string[] {
  return uniqueStrings(text.split(/\r?\n|,/));
}

function snippetsToBulkText(snippets: SnippetReplacement[]): string {
  return groupSnippets(snippets)
    .map((group) => [group.replacement, ...group.triggers].join(", "))
    .join("\n");
}

function parseBulkSnippets(text: string): SnippetReplacement[] {
  const snippets = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      if (line.includes("->")) {
        const [trigger = "", replacement = ""] = line.split("->");
        return [{ trigger: trigger.trim(), replacement: replacement.trim() }];
      }

      const parts = line
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length < 2) return [];
      const [replacement, ...triggers] = parts;
      return triggers.map((trigger) => ({ trigger, replacement }));
    });

  return uniqueSnippets(snippets);
}

function normalizeHistoryRecord(item: any): HistoryRecord | null {
  const text = cleanText(item?.original_text || item?.text || item?.processed_text);
  if (!text) return null;
  return {
    id: item?.id ?? `${text}-${item?.timestamp || ""}`,
    text,
    timestamp: item?.timestamp || item?.created_at,
  };
}

function formatHistoryTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hasHotwordShape(value: string): boolean {
  const word = value.trim();
  if (!word || word.length < 2) return false;
  const lower = word.toLocaleLowerCase();
  if (COMMON_WORDS.has(lower)) return false;
  if (DEFAULT_HOTWORDS.some((item) => hotwordKey(item) === lower)) return true;
  return /[A-Z]/.test(word) || /[0-9.-]/.test(word) || /\s/.test(word) || word.length >= 6;
}

function pushCandidate(candidates: string[], value: string, correct: string): void {
  const cleaned = cleanText(value);
  if (!cleaned || snippetKey(cleaned) === snippetKey(correct)) return;
  if (candidates.some((item) => snippetKey(item) === snippetKey(cleaned))) return;
  candidates.push(cleaned);
}

function generateVariantSuggestions(
  wrong: string,
  correct: string,
  settings: VocabularySettingsData
): GenerationResult {
  const target = cleanText(correct);
  const observed = cleanText(wrong);
  const candidates: string[] = [];
  pushCandidate(candidates, observed, target);

  for (const snippet of DEFAULT_SNIPPETS) {
    if (snippetKey(snippet.replacement) === snippetKey(target)) {
      pushCandidate(candidates, snippet.trigger, target);
    }
  }

  const lowerTarget = target.toLocaleLowerCase();
  const compactTarget = lowerTarget.replace(/[\s.-]+/g, "");
  for (const [key, variants] of Object.entries(TECH_VARIANTS)) {
    if (key === lowerTarget || key.replace(/[\s.-]+/g, "") === compactTarget) {
      variants.forEach((variant) => pushCandidate(candidates, variant, target));
    }
  }

  if (/\s/.test(target)) {
    pushCandidate(candidates, target.replace(/\s+/g, ""), target);
    pushCandidate(candidates, target.toLocaleLowerCase(), target);
  }

  if (/[.-]/.test(target)) {
    pushCandidate(candidates, target.replace(/[.-]/g, " "), target);
    pushCandidate(candidates, target.replace(/[.-]/g, ""), target);
  }

  const existingSnippetKeys = new Set(
    [...DEFAULT_SNIPPETS, ...settings.userSnippets].map((snippet) => snippetKey(snippet.trigger))
  );
  const snippets = candidates.slice(0, 8).map((trigger) => {
    const isDuplicate = existingSnippetKeys.has(snippetKey(trigger));
    return {
      id: `${trigger}->${target}`,
      trigger,
      replacement: target,
      isSelected: !isDuplicate,
      isDuplicate,
    };
  });

  const existingHotwordKeys = new Set(
    [...DEFAULT_HOTWORDS, ...settings.userHotwords].map((word) => hotwordKey(word))
  );
  const shouldAddHotword = hasHotwordShape(target);
  const hotwordDuplicate = existingHotwordKeys.has(hotwordKey(target));
  const hotwords =
    shouldAddHotword || hotwordDuplicate
      ? [
          {
            id: target,
            word: target,
            isSelected: shouldAddHotword && !hotwordDuplicate,
            isDuplicate: hotwordDuplicate,
          },
        ]
      : [];

  return {
    snippets,
    hotwords,
    hotwordReason: shouldAddHotword
      ? "This looks like a proper noun, technical term, model name, or domain-specific phrase that can benefit from ASR boosting."
      : "This looks like ordinary language, so snippet correction is safer than adding it as a hotword.",
  };
}

function CharacterPicker({
  text,
  selected,
  onChange,
}: {
  text: string;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
}) {
  const characters = useMemo(
    () =>
      Array.from(text)
        .map((char, sourceIndex) => ({ char, sourceIndex }))
        .filter((item) => !/\s/u.test(item.char)),
    [text]
  );
  const [dragMode, setDragMode] = useState<"select" | "deselect" | null>(null);

  useEffect(() => {
    if (!dragMode) return;
    const handleMouseUp = () => setDragMode(null);
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [dragMode]);

  const setSelected = useCallback(
    (index: number, forceMode?: "select" | "deselect") => {
      const next = new Set(selected);
      const mode = forceMode || (next.has(index) ? "deselect" : "select");
      if (mode === "select") next.add(index);
      else next.delete(index);
      onChange(next);
      return mode;
    },
    [onChange, selected]
  );

  if (!characters.length) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-6 text-center text-xs text-neutral-500">
        No selectable text.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg bg-neutral-50 p-2">
      {characters.map(({ char, sourceIndex }) => {
        const isSelected = selected.has(sourceIndex);
        return (
          <button
            key={`${char}-${sourceIndex}`}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              setDragMode(setSelected(sourceIndex));
            }}
            onMouseEnter={() => {
              if (dragMode) setSelected(sourceIndex, dragMode);
            }}
            className={`grid h-8 w-8 place-items-center rounded-md text-sm transition ${
              isSelected
                ? "bg-amber-500 text-white shadow-sm"
                : "bg-white text-neutral-800 hover:bg-neutral-100"
            }`}
          >
            {char}
          </button>
        );
      })}
    </div>
  );
}

function CheckboxRow({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`grid h-4 w-4 place-items-center rounded border transition ${
        checked ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-300 bg-white"
      } ${disabled ? "opacity-40" : "hover:border-neutral-600"}`}
    >
      {checked && <Check className="h-3 w-3" />}
    </button>
  );
}

function QuickCorrectionDialog({
  open,
  onOpenChange,
  history,
  onAdd,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: HistoryRecord[];
  onAdd: (snippet: SnippetReplacement) => void;
  t: TFunction;
}) {
  const [sourceText, setSourceText] = useState("");
  const [correctText, setCorrectText] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSourceText(history[0]?.text || "");
    setCorrectText("");
    setSelected(new Set());
  }, [history, open]);

  const selectedText = useMemo(
    () => Array.from(selected).sort((a, b) => a - b).map((index) => sourceText[index]).join(""),
    [selected, sourceText]
  );
  const canAdd = !!selectedText && !!correctText.trim();

  const add = () => {
    if (!canAdd) return;
    onAdd({ trigger: selectedText, replacement: correctText.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-hidden">
        <DialogTitle>{t("vocabulary.quick.title")}</DialogTitle>
        <DialogDescription>{t("vocabulary.quick.desc")}</DialogDescription>

        <div className="grid min-h-0 gap-4 md:grid-cols-[220px_1fr]">
          <div className="min-h-0 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              {t("vocabulary.history")}
            </p>
            <div className="max-h-72 overflow-auto rounded-lg border border-neutral-200">
              {history.length ? (
                history.slice(0, 12).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSourceText(item.text);
                      setSelected(new Set());
                    }}
                    className={`block w-full border-b border-neutral-100 px-3 py-2 text-left last:border-b-0 hover:bg-neutral-50 ${
                      sourceText === item.text ? "bg-amber-50" : ""
                    }`}
                  >
                    <p className="line-clamp-2 text-xs text-neutral-800">{item.text}</p>
                    {item.timestamp && (
                      <p className="mt-1 text-[10px] text-neutral-400">
                        {formatHistoryTime(item.timestamp)}
                      </p>
                    )}
                  </button>
                ))
              ) : (
                <p className="px-3 py-8 text-center text-xs text-neutral-500">
                  {t("vocabulary.history.empty")}
                </p>
              )}
            </div>
          </div>

          <div className="min-h-0 space-y-4">
            <Textarea
              value={sourceText}
              onChange={(event) => {
                setSourceText(event.target.value);
                setSelected(new Set());
              }}
              rows={4}
              placeholder={t("vocabulary.quick.sourcePlaceholder")}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {t("vocabulary.quick.select")}
                </p>
                {selectedText && (
                  <p className="truncate text-xs font-medium text-amber-700">{selectedText}</p>
                )}
              </div>
              <CharacterPicker text={sourceText} selected={selected} onChange={setSelected} />
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {t("vocabulary.correctWord")}
              </p>
              <Input
                value={correctText}
                onChange={(event) => setCorrectText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") add();
                }}
                placeholder={t("vocabulary.correctWord.placeholder")}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("vocabulary.cancel")}
              </Button>
              <Button disabled={!canAdd} onClick={add}>
                {t("vocabulary.add")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SmartCorrectionDialog({
  open,
  onOpenChange,
  history,
  settings,
  onApply,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: HistoryRecord[];
  settings: VocabularySettingsData;
  onApply: (snippets: SnippetReplacement[], hotwords: string[]) => void;
  t: TFunction;
}) {
  const [phase, setPhase] = useState<"input" | "preview">("input");
  const [correctText, setCorrectText] = useState("");
  const [wrongText, setWrongText] = useState("");
  const [historyText, setHistoryText] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<GenerationResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("input");
    setCorrectText("");
    setWrongText("");
    setHistoryText("");
    setSelected(new Set());
    setResult(null);
  }, [open]);

  const selectedHistoryText = useMemo(
    () => Array.from(selected).sort((a, b) => a - b).map((index) => historyText[index]).join(""),
    [historyText, selected]
  );
  const effectiveWrongText = selectedHistoryText || wrongText.trim();
  const canGenerate = !!correctText.trim() && !!effectiveWrongText;
  const selectedCount =
    (result?.snippets.filter((item) => item.isSelected && !item.isDuplicate).length || 0) +
    (result?.hotwords.filter((item) => item.isSelected && !item.isDuplicate).length || 0);

  const generate = () => {
    if (!canGenerate) return;
    setResult(generateVariantSuggestions(effectiveWrongText, correctText, settings));
    setPhase("preview");
  };

  const apply = () => {
    if (!result) return;
    const snippets = result.snippets
      .filter((item) => item.isSelected && !item.isDuplicate)
      .map(({ trigger, replacement }) => ({ trigger, replacement }));
    const hotwords = result.hotwords
      .filter((item) => item.isSelected && !item.isDuplicate)
      .map((item) => item.word);
    onApply(snippets, hotwords);
    onOpenChange(false);
  };

  const updateSnippet = (index: number, checked: boolean) => {
    if (!result) return;
    const snippets = [...result.snippets];
    snippets[index] = { ...snippets[index], isSelected: checked };
    setResult({ ...result, snippets });
  };

  const updateHotword = (index: number, checked: boolean) => {
    if (!result) return;
    const hotwords = [...result.hotwords];
    hotwords[index] = { ...hotwords[index], isSelected: checked };
    setResult({ ...result, hotwords });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-hidden">
        <DialogTitle>{t("vocabulary.smart.title")}</DialogTitle>
        <DialogDescription>{t("vocabulary.smart.desc")}</DialogDescription>

        {phase === "input" ? (
          <div className="grid min-h-0 gap-4 md:grid-cols-[220px_1fr]">
            <div className="min-h-0 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {t("vocabulary.history")}
              </p>
              <div className="max-h-72 overflow-auto rounded-lg border border-neutral-200">
                {history.length ? (
                  history.slice(0, 12).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setHistoryText(item.text);
                        setWrongText("");
                        setSelected(new Set());
                      }}
                      className={`block w-full border-b border-neutral-100 px-3 py-2 text-left last:border-b-0 hover:bg-neutral-50 ${
                        historyText === item.text ? "bg-amber-50" : ""
                      }`}
                    >
                      <p className="line-clamp-2 text-xs text-neutral-800">{item.text}</p>
                      {item.timestamp && (
                        <p className="mt-1 text-[10px] text-neutral-400">
                          {formatHistoryTime(item.timestamp)}
                        </p>
                      )}
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-8 text-center text-xs text-neutral-500">
                    {t("vocabulary.history.empty")}
                  </p>
                )}
              </div>
            </div>

            <div className="min-h-0 space-y-4">
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {t("vocabulary.expectedWord")}
                </p>
                <Input
                  value={correctText}
                  onChange={(event) => setCorrectText(event.target.value)}
                  placeholder={t("vocabulary.expectedWord.placeholder")}
                />
              </div>

              {historyText ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      {t("vocabulary.quick.select")}
                    </p>
                    {selectedHistoryText && (
                      <p className="truncate text-xs font-medium text-amber-700">
                        {selectedHistoryText}
                      </p>
                    )}
                  </div>
                  <CharacterPicker text={historyText} selected={selected} onChange={setSelected} />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {t("vocabulary.actualWord")}
                  </p>
                  <Input
                    value={wrongText}
                    onChange={(event) => setWrongText(event.target.value)}
                    placeholder={t("vocabulary.actualWord.placeholder")}
                  />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t("vocabulary.cancel")}
                </Button>
                <Button disabled={!canGenerate} onClick={generate}>
                  <Wand2 className="h-4 w-4" />
                  {t("vocabulary.generateVariants")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 space-y-4 overflow-auto pr-1">
            <div className="space-y-2 rounded-lg bg-neutral-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {t("vocabulary.snippetSuggestions")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!result) return;
                    setResult({
                      ...result,
                      snippets: result.snippets.map((item) =>
                        item.isDuplicate ? item : { ...item, isSelected: true }
                      ),
                    });
                  }}
                  className="text-xs font-medium text-neutral-700 hover:text-neutral-950"
                >
                  {t("vocabulary.selectAll")}
                </button>
              </div>
              {result?.snippets.length ? (
                result.snippets.map((suggestion, index) => (
                  <div
                    key={suggestion.id}
                    className="flex items-center gap-3 border-t border-neutral-200/70 py-2 first:border-t-0"
                  >
                    <CheckboxRow
                      checked={suggestion.isSelected}
                      disabled={suggestion.isDuplicate}
                      onChange={(checked) => updateSnippet(index, checked)}
                    />
                    <span className="text-sm text-neutral-700">{suggestion.trigger}</span>
                    <ArrowLeft className="h-3.5 w-3.5 text-neutral-400" />
                    <span className="text-sm font-medium text-neutral-950">
                      {suggestion.replacement}
                    </span>
                    {suggestion.isDuplicate && (
                      <span className="rounded bg-white px-2 py-1 text-[10px] font-medium text-neutral-500">
                        {t("vocabulary.exists")}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <p className="py-4 text-center text-xs text-neutral-500">
                  {t("vocabulary.noSnippetSuggestions")}
                </p>
              )}
            </div>

            <div className="space-y-2 rounded-lg bg-neutral-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {t("vocabulary.hotwordSuggestions")}
              </p>
              {result?.hotwords.length ? (
                result.hotwords.map((suggestion, index) => (
                  <div
                    key={suggestion.id}
                    className="flex items-center gap-3 border-t border-neutral-200/70 py-2 first:border-t-0"
                  >
                    <CheckboxRow
                      checked={suggestion.isSelected}
                      disabled={suggestion.isDuplicate}
                      onChange={(checked) => updateHotword(index, checked)}
                    />
                    <span className="text-sm font-medium text-neutral-900">{suggestion.word}</span>
                    {suggestion.isDuplicate && (
                      <span className="rounded bg-white px-2 py-1 text-[10px] font-medium text-neutral-500">
                        {t("vocabulary.exists")}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <p className="py-4 text-center text-xs text-neutral-500">
                  {t("vocabulary.noHotwordSuggestions")}
                </p>
              )}
              {result?.hotwordReason && (
                <p className="text-xs text-neutral-500">{result.hotwordReason}</p>
              )}
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setPhase("input")}>
                {t("vocabulary.backToEdit")}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t("vocabulary.cancel")}
                </Button>
                <Button disabled={selectedCount === 0} onClick={apply}>
                  {t("vocabulary.addSelected", { count: selectedCount })}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function VocabularySettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<VocabularySettingsData>(EMPTY_SETTINGS);
  const [newHotword, setNewHotword] = useState("");
  const [newTrigger, setNewTrigger] = useState("");
  const [newReplacement, setNewReplacement] = useState("");
  const [newTriggerTexts, setNewTriggerTexts] = useState<Record<string, string>>({});
  const [editingReplacement, setEditingReplacement] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [hotwordSort, setHotwordSort] = useState<SortMode>("time");
  const [snippetSort, setSnippetSort] = useState<SortMode>("time");
  const [bulkHotwords, setBulkHotwords] = useState("");
  const [bulkSnippets, setBulkSnippets] = useState("");
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");
  const [highlightedReplacement, setHighlightedReplacement] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadVocabularySettings().then((loaded) => {
      if (!cancelled) setSettings(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const items = await window.electronAPI?.getTranscriptions?.(20);
        if (cancelled || !Array.isArray(items)) return;
        setHistory(items.map(normalizeHistoryRecord).filter((item): item is HistoryRecord => !!item));
      } catch {
        if (!cancelled) setHistory([]);
      }
    };
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveHotwords = useMemo(() => getEffectiveHotwords(settings), [settings]);
  const effectiveSnippets = useMemo(() => getEffectiveSnippets(settings), [settings]);
  const builtinHotwordCount = useMemo(
    () => getEffectiveHotwords({ ...EMPTY_SETTINGS, hotwordsEnabled: true }).length,
    []
  );
  const builtinSnippetCount = useMemo(
    () => getEffectiveSnippets({ ...EMPTY_SETTINGS, snippetsEnabled: true }).length,
    []
  );
  const displayedHotwords = useMemo(() => {
    if (hotwordSort === "time") return settings.userHotwords;
    return [...settings.userHotwords].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [hotwordSort, settings.userHotwords]);
  const displayedSnippetGroups = useMemo(
    () => sortGroups(groupSnippets(settings.userSnippets), snippetSort),
    [settings.userSnippets, snippetSort]
  );
  const allSnippetKeys = useMemo(
    () => new Set([...DEFAULT_SNIPPETS, ...settings.userSnippets].map((item) => snippetKey(item.trigger))),
    [settings.userSnippets]
  );

  const persist = useCallback(async (next: VocabularySettingsData) => {
    const saved = await saveVocabularySettings(next);
    setSettings(saved);
    setSaveState("saved");
    window.setTimeout(() => setSaveState("idle"), 1400);
  }, []);

  const pulseGroup = (replacement: string) => {
    setHighlightedReplacement(replacement);
    window.setTimeout(() => setHighlightedReplacement(null), 1800);
  };

  const openBulkHotwords = () => {
    setBulkHotwords(settings.userHotwords.join("\n"));
    setDialogMode("hotwords");
  };

  const openBulkSnippets = () => {
    setBulkSnippets(snippetsToBulkText(settings.userSnippets));
    setDialogMode("snippets");
  };

  const addHotword = () => {
    const word = newHotword.trim();
    if (!word) return;
    void persist({
      ...settings,
      userHotwords: uniqueStrings([...settings.userHotwords, word]),
    });
    setNewHotword("");
  };

  const removeHotword = (word: string) => {
    void persist({
      ...settings,
      userHotwords: settings.userHotwords.filter((item) => item !== word),
    });
  };

  const saveBulkHotwords = () => {
    void persist({
      ...settings,
      userHotwords: parseBulkHotwords(bulkHotwords),
    });
    setDialogMode(null);
  };

  const addSnippet = () => {
    const trigger = newTrigger.trim();
    const replacement = newReplacement.trim();
    if (!trigger || !replacement || snippetKey(trigger) === snippetKey(replacement)) return;
    if (allSnippetKeys.has(snippetKey(trigger))) {
      setNewTrigger("");
      return;
    }
    void persist({
      ...settings,
      userSnippets: uniqueSnippets([...settings.userSnippets, { trigger, replacement }]),
    });
    setNewTrigger("");
    setNewReplacement("");
    pulseGroup(replacement);
  };

  const addSnippetToGroup = (replacement: string) => {
    const trigger = (newTriggerTexts[replacement] || "").trim();
    if (!trigger || allSnippetKeys.has(snippetKey(trigger))) {
      setNewTriggerTexts((prev) => ({ ...prev, [replacement]: "" }));
      return;
    }
    void persist({
      ...settings,
      userSnippets: uniqueSnippets([...settings.userSnippets, { trigger, replacement }]),
    });
    setNewTriggerTexts((prev) => ({ ...prev, [replacement]: "" }));
    pulseGroup(replacement);
  };

  const removeTrigger = (trigger: string, replacement: string) => {
    void persist({
      ...settings,
      userSnippets: settings.userSnippets.filter(
        (item) => item.trigger !== trigger || item.replacement !== replacement
      ),
    });
  };

  const removeGroup = (replacement: string) => {
    void persist({
      ...settings,
      userSnippets: settings.userSnippets.filter((item) => item.replacement !== replacement),
    });
  };

  const startGroupEdit = (replacement: string) => {
    setEditingReplacement(replacement);
    setEditingText(replacement);
  };

  const commitGroupEdit = (oldReplacement: string) => {
    const replacement = editingText.trim();
    if (!replacement || replacement === oldReplacement) {
      setEditingReplacement(null);
      return;
    }
    void persist({
      ...settings,
      userSnippets: settings.userSnippets.map((snippet) =>
        snippet.replacement === oldReplacement ? { ...snippet, replacement } : snippet
      ),
    });
    setEditingReplacement(null);
    pulseGroup(replacement);
  };

  const saveBulkSnippets = () => {
    void persist({
      ...settings,
      userSnippets: parseBulkSnippets(bulkSnippets),
    });
    setDialogMode(null);
  };

  const applyQuickSnippet = (snippet: SnippetReplacement) => {
    if (allSnippetKeys.has(snippetKey(snippet.trigger))) return;
    void persist({
      ...settings,
      userSnippets: uniqueSnippets([...settings.userSnippets, snippet]),
    });
    pulseGroup(snippet.replacement);
  };

  const applySmartSuggestions = (snippets: SnippetReplacement[], hotwords: string[]) => {
    void persist({
      ...settings,
      userHotwords: uniqueStrings([...settings.userHotwords, ...hotwords]),
      userSnippets: uniqueSnippets([...settings.userSnippets, ...snippets]),
    });
    const firstReplacement = snippets[0]?.replacement;
    if (firstReplacement) pulseGroup(firstReplacement);
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{t("vocabulary.title")}</h3>
          <p className="mt-2 max-w-3xl text-sm text-gray-600">{t("vocabulary.desc")}</p>
          {saveState === "saved" && (
            <p className="mt-2 text-xs font-medium text-green-700">{t("vocabulary.saved")}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setDialogMode("quick")}>
            <ListChecks className="h-4 w-4" />
            {t("vocabulary.quick.open")}
          </Button>
          <Button size="sm" onClick={() => setDialogMode("smart")}>
            <Sparkles className="h-4 w-4" />
            {t("vocabulary.smart.open")}
          </Button>
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-neutral-900">{t("vocabulary.hotwords")}</h4>
              <button
                type="button"
                onClick={() => setHotwordSort((prev) => (prev === "time" ? "alpha" : "time"))}
                className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900"
              >
                {hotwordSort === "time" ? (
                  <Clock className="h-3.5 w-3.5" />
                ) : (
                  <span className="text-[11px] font-semibold">ABC</span>
                )}
                {hotwordSort === "time"
                  ? t("vocabulary.sort.time")
                  : t("vocabulary.sort.alpha")}
              </button>
              <button
                type="button"
                onClick={openBulkHotwords}
                className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900"
              >
                <ListChecks className="h-3.5 w-3.5" />
                {t("vocabulary.bulkEdit")}
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {t("vocabulary.hotwords.desc", {
                total: effectiveHotwords.length,
                builtin: builtinHotwordCount,
              })}
            </p>
          </div>
          <Toggle
            checked={settings.hotwordsEnabled}
            onChange={(checked) => void persist({ ...settings, hotwordsEnabled: checked })}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {displayedHotwords.map((word) => (
            <button
              key={word}
              type="button"
              onClick={() => removeHotword(word)}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-neutral-50 px-3 text-xs font-medium text-neutral-700 hover:bg-red-50 hover:text-red-700"
            >
              {word}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={newHotword}
            onChange={(event) => setNewHotword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addHotword();
            }}
            placeholder={t("vocabulary.hotword.placeholder")}
            className="h-10 min-w-0 flex-1 border-dashed text-sm"
          />
          <Button
            type="button"
            onClick={addHotword}
            disabled={!newHotword.trim()}
            className="h-10 shrink-0 px-4"
          >
            <Check className="h-4 w-4" />
            {t("vocabulary.saveHotword")}
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-neutral-900">{t("vocabulary.snippets")}</h4>
              <button
                type="button"
                onClick={() => setSnippetSort((prev) => (prev === "time" ? "alpha" : "time"))}
                className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900"
              >
                {snippetSort === "time" ? (
                  <Clock className="h-3.5 w-3.5" />
                ) : (
                  <span className="text-[11px] font-semibold">ABC</span>
                )}
                {snippetSort === "time"
                  ? t("vocabulary.sort.time")
                  : t("vocabulary.sort.alpha")}
              </button>
              <button
                type="button"
                onClick={openBulkSnippets}
                className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900"
              >
                <ListChecks className="h-3.5 w-3.5" />
                {t("vocabulary.bulkEdit")}
              </button>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {t("vocabulary.snippets.desc", {
                total: effectiveSnippets.length,
                builtin: builtinSnippetCount,
              })}
            </p>
          </div>
          <Toggle
            checked={settings.snippetsEnabled}
            onChange={(checked) => void persist({ ...settings, snippetsEnabled: checked })}
          />
        </div>

        <div className="rounded-xl bg-neutral-50 p-3">
          <div className="mb-3 flex items-center gap-2">
            <Input
              value={newReplacement}
              onChange={(event) => setNewReplacement(event.target.value)}
              placeholder={t("vocabulary.replacement")}
              className="h-9 max-w-[220px] border-dashed text-sm"
            />
            <ArrowLeft className="h-4 w-4 text-neutral-400" />
            <Input
              value={newTrigger}
              onChange={(event) => setNewTrigger(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addSnippet();
              }}
              placeholder={t("vocabulary.trigger")}
              className="h-9 max-w-[180px] border-dashed text-sm"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={addSnippet}
              disabled={!newTrigger.trim() || !newReplacement.trim()}
              title={t("vocabulary.add")}
            >
              <Plus className="h-5 w-5 text-green-700" />
            </Button>
          </div>

          <div className="rounded-lg bg-white">
            <div className="flex items-center border-b border-neutral-100 px-3 py-2 text-xs font-medium text-neutral-500">
              <span>{t("vocabulary.global")}</span>
            </div>

            {displayedSnippetGroups.length ? (
              displayedSnippetGroups.map((group) => (
                <div
                  key={group.replacement}
                  className={`flex flex-col gap-2 border-b border-neutral-100 px-3 py-3 last:border-b-0 md:flex-row md:items-center ${
                    highlightedReplacement === group.replacement ? "bg-green-50" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2 md:w-52">
                    {editingReplacement === group.replacement ? (
                      <Input
                        value={editingText}
                        autoFocus
                        onChange={(event) => setEditingText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitGroupEdit(group.replacement);
                          if (event.key === "Escape") setEditingReplacement(null);
                        }}
                        className="h-8 text-sm"
                      />
                    ) : (
                      <span className="truncate text-sm font-medium text-neutral-950">
                        {group.replacement}
                      </span>
                    )}
                    <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {group.triggers.map((trigger, index) => (
                      <span key={`${trigger}-${index}`} className="inline-flex items-center gap-1">
                        {index > 0 && <span className="h-4 w-px bg-neutral-200" />}
                        <button
                          type="button"
                          onClick={() => removeTrigger(trigger, group.replacement)}
                          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-neutral-600 hover:bg-red-50 hover:text-red-700"
                        >
                          {trigger}
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <span className="h-4 w-px bg-neutral-200" />
                    <Input
                      value={newTriggerTexts[group.replacement] || ""}
                      onChange={(event) =>
                        setNewTriggerTexts((prev) => ({
                          ...prev,
                          [group.replacement]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addSnippetToGroup(group.replacement);
                      }}
                      placeholder={t("vocabulary.addTrigger")}
                      className="h-7 w-24 border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-1"
                    />
                  </div>

                  <div className="flex items-center gap-1 self-end md:self-auto">
                    {editingReplacement === group.replacement ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => commitGroupEdit(group.replacement)}
                        >
                          <Check className="h-4 w-4 text-green-700" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setEditingReplacement(null)}>
                          <X className="h-4 w-4 text-neutral-500" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startGroupEdit(group.replacement)}
                          title={t("vocabulary.editGroup")}
                        >
                          <Edit3 className="h-4 w-4 text-neutral-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeGroup(group.replacement)}
                          title={t("vocabulary.removeGroup")}
                        >
                          <Trash2 className="h-4 w-4 text-neutral-500" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="px-3 py-8 text-center text-xs text-neutral-500">
                {t("vocabulary.snippets.empty")}
              </p>
            )}
          </div>
        </div>
      </section>

      <Dialog open={dialogMode === "hotwords"} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent className="max-w-xl">
          <DialogTitle>{t("vocabulary.bulkHotwords.title")}</DialogTitle>
          <DialogDescription>{t("vocabulary.bulkHotwords.desc")}</DialogDescription>
          <Textarea
            value={bulkHotwords}
            onChange={(event) => setBulkHotwords(event.target.value)}
            rows={12}
            placeholder={t("vocabulary.hotwords.bulkPlaceholder")}
          />
          <p className="text-xs text-neutral-500">
            {t("vocabulary.hotwordCount", { count: parseBulkHotwords(bulkHotwords).length })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogMode(null)}>
              {t("vocabulary.cancel")}
            </Button>
            <Button onClick={saveBulkHotwords}>{t("vocabulary.save")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogMode === "snippets"} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent className="max-w-xl">
          <DialogTitle>{t("vocabulary.bulkSnippets.title")}</DialogTitle>
          <DialogDescription>{t("vocabulary.bulkSnippets.desc")}</DialogDescription>
          <Textarea
            value={bulkSnippets}
            onChange={(event) => setBulkSnippets(event.target.value)}
            rows={12}
            placeholder={t("vocabulary.snippets.bulkPlaceholder")}
          />
          <p className="text-xs text-neutral-500">
            {t("vocabulary.snippetGroupCount", {
              count: groupSnippets(parseBulkSnippets(bulkSnippets)).length,
            })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogMode(null)}>
              {t("vocabulary.cancel")}
            </Button>
            <Button onClick={saveBulkSnippets}>{t("vocabulary.save")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <QuickCorrectionDialog
        open={dialogMode === "quick"}
        onOpenChange={(open) => setDialogMode(open ? "quick" : null)}
        history={history}
        onAdd={applyQuickSnippet}
        t={t}
      />

      <SmartCorrectionDialog
        open={dialogMode === "smart"}
        onOpenChange={(open) => setDialogMode(open ? "smart" : null)}
        history={history}
        settings={settings}
        onApply={applySmartSuggestions}
        t={t}
      />
    </div>
  );
}
