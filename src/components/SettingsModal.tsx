import React from "react";
import { Settings, Mic, Brain, User, Sparkles, Wrench } from "lucide-react";
import SidebarModal, { SidebarItem } from "./ui/SidebarModal";
import SettingsPage, { SettingsSectionType } from "./SettingsPage";
import { useI18n } from "../i18n";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { t } = useI18n();

  const sidebarItems: SidebarItem<SettingsSectionType>[] = [
    { id: "general", label: t("settings.general"), icon: Settings },
    { id: "transcription", label: t("settings.transcription"), icon: Mic },
    { id: "aiModels", label: t("settings.aiModels"), icon: Brain },
    { id: "agentConfig", label: t("settings.agentConfig"), icon: User },
    { id: "prompts", label: t("settings.promptStudio"), icon: Sparkles },
    { id: "developer", label: t("settings.developer"), icon: Wrench },
  ];

  const [activeSection, setActiveSection] = React.useState<SettingsSectionType>("general");

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={onOpenChange}
      title={t("controlPanel.settings")}
      sidebarItems={sidebarItems}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
    >
      <SettingsPage activeSection={activeSection} />
    </SidebarModal>
  );
}
