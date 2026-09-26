import React from "react";
import { AstryxCompatButton as Button } from "./astryxFormControls";
import { HelpCircle, Mail, Bug } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { platform } from "../../shared/platform";

interface SupportDropdownProps {
  className?: string;
}

type OpenExternalResult = { success: boolean; error?: string } | void;

const getExternalOpenError = (result: OpenExternalResult): string | undefined => {
  return typeof result === "object" && result !== null ? result.error : undefined;
};

const didExternalOpenFail = (result: OpenExternalResult): boolean => {
  return typeof result !== "object" || result === null || result.success === false;
};

export default function SupportDropdown({ className }: SupportDropdownProps) {
  const handleContactSupport = async () => {
    try {
      const result = await platform.app.openExternal("mailto:support@typefree.com");
      if (didExternalOpenFail(result)) {
        console.error("Failed to open email client:", getExternalOpenError(result));
        // Fallback: try opening the email as a web URL
        await platform.app.openExternal(
          "https://mail.google.com/mail/?view=cm&to=support@typefree.com"
        );
      }
    } catch (error) {
      console.error("Error opening email client:", error);
    }
  };

  const handleSubmitBug = async () => {
    try {
      const result = await platform.app.openExternal(
        "https://github.com/HeroTools/open-whispr/issues"
      );
      if (didExternalOpenFail(result)) {
        console.error("Failed to open GitHub issues:", getExternalOpenError(result));
      }
    } catch (error) {
      console.error("Error opening GitHub issues:", error);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className}>
          <HelpCircle size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-white border border-gray-200 shadow-lg">
        <DropdownMenuItem
          onClick={handleContactSupport}
          className="cursor-pointer hover:bg-gray-50 focus:bg-gray-50"
        >
          <Mail className="mr-2 h-4 w-4" />
          Contact Support
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleSubmitBug}
          className="cursor-pointer hover:bg-gray-50 focus:bg-gray-50"
        >
          <Bug className="mr-2 h-4 w-4" />
          Submit Bug
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
