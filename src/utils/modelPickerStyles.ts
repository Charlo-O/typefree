export type ColorScheme = "purple" | "indigo" | "blue";

export interface ModelPickerStyles {
  container: string;
  progress: string;
  progressText: string;
  progressBar: string;
  progressFill: string;
  header: string;
  modelCard: { selected: string; default: string };
  badges: { selected: string; downloaded: string; recommended: string };
  buttons: { download: string; select: string; delete: string; refresh: string };
}

export const MODEL_PICKER_COLORS: Record<ColorScheme, ModelPickerStyles> = {
  purple: {
    container: "border border-gray-200 rounded-xl overflow-hidden",
    progress: "bg-neutral-50 border-b border-neutral-200",
    progressText: "text-neutral-900",
    progressBar: "bg-neutral-200",
    progressFill: "bg-gradient-to-r from-neutral-700 to-neutral-900",
    header: "font-medium text-neutral-900",
    modelCard: {
      selected: "border-neutral-900 bg-neutral-50",
      default: "border-gray-200 bg-white hover:border-gray-300",
    },
    badges: {
      selected: "text-xs text-neutral-900 bg-neutral-100 px-2 py-1 rounded-full font-medium",
      downloaded: "text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded",
      recommended: "text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded",
    },
    buttons: {
      download: "bg-neutral-900 hover:bg-neutral-800",
      select: "border-neutral-300 text-neutral-700 hover:bg-neutral-50",
      delete: "text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200",
      refresh: "border-neutral-300 text-neutral-700 hover:bg-neutral-50",
    },
  },
  indigo: {
    container: "border border-gray-200 rounded-xl overflow-hidden",
    progress: "bg-neutral-50 border-b border-neutral-200",
    progressText: "text-neutral-900",
    progressBar: "bg-neutral-200",
    progressFill: "bg-gradient-to-r from-neutral-700 to-neutral-900",
    header: "font-medium text-neutral-900",
    modelCard: {
      selected: "border-neutral-900 bg-neutral-50",
      default: "border-gray-200 bg-white hover:border-gray-300",
    },
    badges: {
      selected: "text-xs text-neutral-900 bg-neutral-100 px-2 py-1 rounded-full font-medium",
      downloaded: "text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded",
      recommended: "text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded",
    },
    buttons: {
      download: "bg-neutral-900 hover:bg-neutral-800",
      select: "border-neutral-300 text-neutral-700 hover:bg-neutral-50",
      delete: "text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200",
      refresh: "border-neutral-300 text-neutral-700 hover:bg-neutral-50",
    },
  },
  blue: {
    container: "bg-gray-50 rounded-lg overflow-hidden border border-gray-200",
    progress: "bg-neutral-50 border-b border-neutral-200",
    progressText: "text-neutral-900",
    progressBar: "bg-neutral-200",
    progressFill: "bg-gradient-to-r from-neutral-700 to-neutral-900",
    header: "font-medium text-gray-900",
    modelCard: {
      selected: "border-neutral-900 bg-neutral-50",
      default: "border-gray-200 bg-white hover:border-gray-300",
    },
    badges: {
      selected: "text-xs text-neutral-900 bg-neutral-100 px-2 py-1 rounded-full font-medium",
      downloaded: "text-xs text-green-600 bg-green-100 px-2 py-1 rounded",
      recommended: "text-xs bg-primary/10 text-primary px-2 py-1 rounded",
    },
    buttons: {
      download: "bg-neutral-900 hover:bg-neutral-800",
      select: "border-gray-300 text-gray-700 hover:bg-gray-50",
      delete: "text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200",
      refresh: "border-gray-300 text-gray-700 hover:bg-gray-50",
    },
  },
};

export function getModelPickerStyles(colorScheme: ColorScheme): ModelPickerStyles {
  return MODEL_PICKER_COLORS[colorScheme];
}
