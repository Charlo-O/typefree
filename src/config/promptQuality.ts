import { readPromptContextSettings } from "./promptContext";

export interface PromptQualityIssue {
  id: string;
  label: string;
  weight: number;
  passed: boolean;
  detail: string;
}

export interface PromptQualityReport {
  score: number;
  maxScore: number;
  percentage: number;
  passed: number;
  total: number;
  issues: PromptQualityIssue[];
  strengths: PromptQualityIssue[];
}

interface PromptQualityRule {
  id: string;
  label: string;
  weight: number;
  detail: string;
  any?: RegExp[];
  all?: RegExp[];
}

const PROMPT_QUALITY_RULES: PromptQualityRule[] = [
  {
    id: "speech-cleanup",
    label: "Speech cleanup role",
    weight: 12,
    detail: "Prompt should clearly define cleanup/polish as the default dictation task.",
    any: [/speech|dictation|transcribed|transcription|语音|听写|转录|转写/i],
    all: [/clean|cleanup|polish|整理|清理|润色|修正/i],
  },
  {
    id: "output-boundary",
    label: "Output boundary",
    weight: 12,
    detail: "Prompt should forbid explanations, alternatives, and meta commentary.",
    any: [/output only|only.*processed|只输出|不要.*解释|不要.*说明|不要.*前言/i],
  },
  {
    id: "question-preservation",
    label: "Question preservation",
    weight: 12,
    detail: "Question-like speech should be cleaned as dictation instead of answered.",
    any: [/do not answer|question-like|问题句|不要回答|不是在向你提问/i],
  },
  {
    id: "self-correction",
    label: "Self-correction handling",
    weight: 12,
    detail: "Prompt should prioritize later corrections such as 'no, change it to...'.",
    any: [/self-?correction|false starts|不对|哦不|不是|算了|改成|重说|最终确认/i],
  },
  {
    id: "single-numbering",
    label: "Single numbering guard",
    weight: 10,
    detail: "Prompt should avoid producing a lone numbered item when there is only one point.",
    any: [/single numbered|single numbering|只有\s*1\s*个|只.*1.*要点|单独.*编号|不要.*1\./i],
  },
  {
    id: "number-normalization",
    label: "Number normalization",
    weight: 10,
    detail: "Prompt should normalize spoken numbers, percentages, times, and units.",
    any: [/number|percentage|percent|time|数字|百分比|时间|金额|度量/i],
  },
  {
    id: "term-preservation",
    label: "Term preservation",
    weight: 10,
    detail: "Prompt should preserve technical terms, product names, acronyms, and code-like text.",
    any: [/technical terms|proper nouns|acronyms|专业术语|专有名词|产品名|英文缩写|变量名/i],
  },
  {
    id: "context-control",
    label: "Context control",
    weight: 10,
    detail: "Prompt stack should support selected text / clipboard context with clear boundaries.",
    any: [/\{selected\}|\{clipboard\}|selected text|clipboard|上下文|选中文本|剪贴板/i],
  },
  {
    id: "format-balance",
    label: "Formatting balance",
    weight: 7,
    detail:
      "Prompt should format lists, emails, and paragraphs without over-formatting short speech.",
    any: [/format|numbered list|bullet|paragraph|email|格式|分点|编号|段落|邮件|不要过度/i],
  },
  {
    id: "style-preservation",
    label: "Style preservation",
    weight: 5,
    detail: "Prompt should preserve the speaker's tone, formality, and intent.",
    any: [/tone|intent|formality|natural voice|语气|意图|风格|正式程度|自然/i],
  },
];

function matchesAny(prompt: string, patterns?: RegExp[]): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => pattern.test(prompt));
}

function matchesAll(prompt: string, patterns?: RegExp[]): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  return patterns.every((pattern) => pattern.test(prompt));
}

export function scorePromptTemplate(
  prompt: string,
  options: { contextEnabled?: boolean } = {}
): PromptQualityReport {
  const contextEnabled = options.contextEnabled ?? readPromptContextSettings().enabled;
  const normalizedPrompt = `${prompt}\n${contextEnabled ? "selected text clipboard context" : ""}`;
  const issues: PromptQualityIssue[] = [];
  const strengths: PromptQualityIssue[] = [];
  let score = 0;

  for (const rule of PROMPT_QUALITY_RULES) {
    const passed = matchesAny(normalizedPrompt, rule.any) && matchesAll(normalizedPrompt, rule.all);
    const item: PromptQualityIssue = {
      id: rule.id,
      label: rule.label,
      weight: rule.weight,
      passed,
      detail: rule.detail,
    };

    if (passed) {
      score += rule.weight;
      strengths.push(item);
    } else {
      issues.push(item);
    }
  }

  const maxScore = PROMPT_QUALITY_RULES.reduce((sum, rule) => sum + rule.weight, 0);
  return {
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    passed: strengths.length,
    total: PROMPT_QUALITY_RULES.length,
    issues,
    strengths,
  };
}

export default {
  scorePromptTemplate,
};
