import React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./input";

interface ApiKeyInputProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  className?: string;
  placeholder?: string;
  label?: string;
  helpText?: React.ReactNode;
  variant?: "default" | "purple";
}

export default function ApiKeyInput({
  apiKey,
  setApiKey,
  className = "",
  placeholder = "sk-...",
  label = "API Key",
  helpText = "Get your API key from platform.openai.com",
  variant = "default",
}: ApiKeyInputProps) {
  const [isVisible, setIsVisible] = React.useState(false);
  const inputId = React.useId();

  const variantClasses = variant === "purple" ? "border-neutral-300 focus:border-neutral-500" : "";

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-2 block text-sm font-medium text-neutral-700">
          {label}
        </label>
      )}
      <div className="relative">
        <Input
          id={inputId}
          type={isVisible ? "text" : "password"}
          placeholder={placeholder}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          aria-label={label || "API Key"}
          autoComplete="off"
          spellCheck={false}
          className={`pr-10 ${variantClasses}`}
        />
        <button
          type="button"
          onClick={() => setIsVisible((value) => !value)}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-neutral-400 transition-colors hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-900/15"
          aria-label={isVisible ? "Hide API Key" : "Show API Key"}
        >
          {isVisible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {helpText && <p className="text-xs text-neutral-600 mt-2">{helpText}</p>}
    </div>
  );
}
