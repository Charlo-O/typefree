import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Toggle } from "./ui/toggle";
import {
  getEffectiveHotwords,
  getEffectiveSnippets,
  loadVocabularySettings,
  saveVocabularySettings,
  type SnippetReplacement,
  type VocabularySettings as VocabularySettingsData,
} from "../utils/vocabulary";
import { useI18n } from "../i18n";

const EMPTY_SETTINGS: VocabularySettingsData = {
  hotwordsEnabled: true,
  snippetsEnabled: true,
  userHotwords: [],
  userSnippets: [],
};

function parseBulkSnippets(text: string): SnippetReplacement[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.includes("->") ? "->" : ",";
      const [trigger = "", replacement = ""] = line.split(separator);
      return {
        trigger: trigger.trim(),
        replacement: replacement.trim(),
      };
    })
    .filter((item) => item.trigger && item.replacement && item.trigger !== item.replacement);
}

export default function VocabularySettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<VocabularySettingsData>(EMPTY_SETTINGS);
  const [newHotword, setNewHotword] = useState("");
  const [newTrigger, setNewTrigger] = useState("");
  const [newReplacement, setNewReplacement] = useState("");
  const [bulkHotwords, setBulkHotwords] = useState("");
  const [bulkSnippets, setBulkSnippets] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");

  useEffect(() => {
    let cancelled = false;
    void loadVocabularySettings().then((loaded) => {
      if (!cancelled) setSettings(loaded);
    });
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

  const persist = async (next: VocabularySettingsData) => {
    const saved = await saveVocabularySettings(next);
    setSettings(saved);
    setSaveState("saved");
    window.setTimeout(() => setSaveState("idle"), 1400);
  };

  const addHotword = () => {
    const word = newHotword.trim();
    if (!word) return;
    void persist({
      ...settings,
      userHotwords: [...settings.userHotwords, word],
    });
    setNewHotword("");
  };

  const removeHotword = (word: string) => {
    void persist({
      ...settings,
      userHotwords: settings.userHotwords.filter((item) => item !== word),
    });
  };

  const addSnippet = () => {
    const trigger = newTrigger.trim();
    const replacement = newReplacement.trim();
    if (!trigger || !replacement || trigger === replacement) return;
    void persist({
      ...settings,
      userSnippets: [...settings.userSnippets, { trigger, replacement }],
    });
    setNewTrigger("");
    setNewReplacement("");
  };

  const removeSnippet = (snippet: SnippetReplacement) => {
    void persist({
      ...settings,
      userSnippets: settings.userSnippets.filter(
        (item) => item.trigger !== snippet.trigger || item.replacement !== snippet.replacement
      ),
    });
  };

  const importHotwords = () => {
    const words = bulkHotwords
      .split(/\r?\n|,/)
      .map((word) => word.trim())
      .filter(Boolean);
    if (!words.length) return;
    void persist({
      ...settings,
      userHotwords: [...settings.userHotwords, ...words],
    });
    setBulkHotwords("");
  };

  const importSnippets = () => {
    const snippets = parseBulkSnippets(bulkSnippets);
    if (!snippets.length) return;
    void persist({
      ...settings,
      userSnippets: [...settings.userSnippets, ...snippets],
    });
    setBulkSnippets("");
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{t("vocabulary.title")}</h3>
        <p className="text-sm text-gray-600">{t("vocabulary.desc")}</p>
        {saveState === "saved" && (
          <p className="mt-2 text-xs font-medium text-green-700">{t("vocabulary.saved")}</p>
        )}
      </div>

      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-neutral-900">{t("vocabulary.hotwords")}</h4>
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

        <div className="flex gap-2">
          <Input
            value={newHotword}
            onChange={(event) => setNewHotword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addHotword();
            }}
            placeholder={t("vocabulary.hotword.placeholder")}
          />
          <Button onClick={addHotword} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            {t("vocabulary.add")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {settings.userHotwords.map((word) => (
            <button
              key={word}
              type="button"
              onClick={() => removeHotword(word)}
              className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              {word}
              <Trash2 className="h-3 w-3" />
            </button>
          ))}
        </div>

        <div className="space-y-2 border-t border-neutral-100 pt-4">
          <Textarea
            value={bulkHotwords}
            onChange={(event) => setBulkHotwords(event.target.value)}
            rows={3}
            placeholder={t("vocabulary.hotwords.bulkPlaceholder")}
          />
          <Button variant="outline" size="sm" onClick={importHotwords}>
            <Upload className="mr-2 h-4 w-4" />
            {t("vocabulary.importHotwords")}
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-semibold text-neutral-900">{t("vocabulary.snippets")}</h4>
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

        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <Input
            value={newTrigger}
            onChange={(event) => setNewTrigger(event.target.value)}
            placeholder={t("vocabulary.trigger")}
          />
          <Input
            value={newReplacement}
            onChange={(event) => setNewReplacement(event.target.value)}
            placeholder={t("vocabulary.replacement")}
          />
          <Button onClick={addSnippet}>
            <Plus className="mr-2 h-4 w-4" />
            {t("vocabulary.add")}
          </Button>
        </div>

        <div className="space-y-2">
          {settings.userSnippets.map((snippet) => (
            <div
              key={`${snippet.trigger}->${snippet.replacement}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="text-neutral-500">{snippet.trigger}</span>
                <span className="mx-2 text-neutral-400">-&gt;</span>
                <span className="font-medium text-neutral-900">{snippet.replacement}</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeSnippet(snippet)}>
                <Trash2 className="h-4 w-4 text-neutral-500" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-neutral-100 pt-4">
          <Textarea
            value={bulkSnippets}
            onChange={(event) => setBulkSnippets(event.target.value)}
            rows={4}
            placeholder={t("vocabulary.snippets.bulkPlaceholder")}
          />
          <Button variant="outline" size="sm" onClick={importSnippets}>
            <Upload className="mr-2 h-4 w-4" />
            {t("vocabulary.importSnippets")}
          </Button>
        </div>
      </section>
    </div>
  );
}
