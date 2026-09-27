import React from "react";
import { Tooltip as AstryxTooltip } from "@astryxdesign/core/Tooltip";

interface TooltipProps {
  children: React.ReactNode;
  content: string;
}

export const Tooltip = ({ children, content }: TooltipProps) => {
  return <AstryxTooltip content={content}>{children}</AstryxTooltip>;
};
