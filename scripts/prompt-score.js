#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const promptPathArg = args.find((arg) => arg.startsWith("--prompt="));
const minArg = args.find((arg) => arg.startsWith("--min="));
const promptPath = promptPathArg
  ? path.resolve(process.cwd(), promptPathArg.slice("--prompt=".length))
  : path.resolve(__dirname, "../src/config/promptData.json");
const minimum = minArg ? Number.parseInt(minArg.slice("--min=".length), 10) : 0;
const contextEnabled = !args.includes("--no-context");

const rules = [
  {
    id: "speech-cleanup",
    label: "Speech cleanup role",
    weight: 12,
    any: [/speech|dictation|transcribed|transcription|语音|听写|转录|转写/i],
    all: [/clean|cleanup|polish|整理|清理|润色|修正/i],
  },
  {
    id: "output-boundary",
    label: "Output boundary",
    weight: 12,
    any: [/output only|only.*processed|只输出|不要.*解释|不要.*说明|不要.*前言/i],
  },
  {
    id: "question-preservation",
    label: "Question preservation",
    weight: 12,
    any: [/do not answer|question-like|问题句|不要回答|不是在向你提问/i],
  },
  {
    id: "self-correction",
    label: "Self-correction handling",
    weight: 12,
    any: [/self-?correction|false starts|不对|哦不|不是|算了|改成|重说|最终确认/i],
  },
  {
    id: "single-numbering",
    label: "Single numbering guard",
    weight: 10,
    any: [/single numbered|single numbering|只有\s*1\s*个|只.*1.*要点|单独.*编号|不要.*1\./i],
  },
  {
    id: "number-normalization",
    label: "Number normalization",
    weight: 10,
    any: [/number|percentage|percent|time|数字|百分比|时间|金额|度量/i],
  },
  {
    id: "term-preservation",
    label: "Term preservation",
    weight: 10,
    any: [/technical terms|proper nouns|acronyms|专业术语|专有名词|产品名|英文缩写|变量名/i],
  },
  {
    id: "context-control",
    label: "Context control",
    weight: 10,
    any: [/\{selected\}|\{clipboard\}|selected text|clipboard|上下文|选中文本|剪贴板/i],
  },
  {
    id: "format-balance",
    label: "Formatting balance",
    weight: 7,
    any: [/format|numbered list|bullet|paragraph|email|格式|分点|编号|段落|邮件|不要过度/i],
  },
  {
    id: "style-preservation",
    label: "Style preservation",
    weight: 5,
    any: [/tone|intent|formality|natural voice|语气|意图|风格|正式程度|自然/i],
  },
];

function matchesAny(prompt, patterns) {
  return !patterns || patterns.length === 0 || patterns.some((pattern) => pattern.test(prompt));
}

function matchesAll(prompt, patterns) {
  return !patterns || patterns.length === 0 || patterns.every((pattern) => pattern.test(prompt));
}

function scorePrompt(prompt) {
  const normalizedPrompt = `${prompt}\n${contextEnabled ? "selected text clipboard context" : ""}`;
  const maxScore = rules.reduce((sum, rule) => sum + rule.weight, 0);
  const results = rules.map((rule) => {
    const passed = matchesAny(normalizedPrompt, rule.any) && matchesAll(normalizedPrompt, rule.all);
    return { ...rule, passed };
  });
  const score = results.reduce((sum, rule) => sum + (rule.passed ? rule.weight : 0), 0);
  return { score, maxScore, results };
}

function loadPrompt(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed.UNIFIED_SYSTEM_PROMPT !== "string") {
    throw new Error(`No UNIFIED_SYSTEM_PROMPT string found in ${filePath}`);
  }
  return parsed.UNIFIED_SYSTEM_PROMPT;
}

const prompt = loadPrompt(promptPath);
const report = scorePrompt(prompt);
const missing = report.results.filter((item) => !item.passed);
const passed = report.results.length - missing.length;

console.log(`Prompt quality score: ${report.score}/${report.maxScore}`);
console.log(`Checks passed: ${passed}/${report.results.length}`);

if (missing.length > 0) {
  console.log("\nMissing checks:");
  for (const item of missing) {
    console.log(`- ${item.label} (${item.weight} pts)`);
  }
}

if (minimum > 0 && report.score < minimum) {
  console.error(`\nScore is below required minimum ${minimum}.`);
  process.exit(1);
}
