import React from "react";
import { Switch as AstryxSwitch } from "@astryxdesign/core/Switch";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const Toggle = ({ checked, onChange, disabled = false }: ToggleProps) => (
  <AstryxSwitch
    label="Toggle"
    isLabelHidden
    size="sm"
    value={checked}
    isDisabled={disabled}
    className="typefree-toggle inline-flex h-5 w-9"
    onChange={(nextValue) => onChange(nextValue)}
  />
);
