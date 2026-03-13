import type { UILanguage } from "./types";

/**
 * English (US) translations - Master copy
 */
const EN_US: Record<string, string> = {
  // App-level
  "app.loading": "Loading TypeFree...",
  "app.hideForNow": "Hide for now",
  "app.startListening": "Start listening",
  "app.stopListening": "Stop listening",
  "app.processing": "Processing...",
  "app.recording": "Recording...",
  "app.pressHotkeyToSpeak": "Press [{hotkey}] to speak",
  "app.cancelRecording": "Cancel recording",
  "app.clickToSpeak": "Click microphone or press {hotkey} to speak",
  "app.clickOrPress": "Click or press {hotkey}",
  "app.holdingToRecord": "Release to stop",
  "app.hotkeyUnavailableDesc":
    "Could not register hotkey. Please set a different hotkey in Settings.",

  // Control Panel
  "controlPanel.title": "TypeFree - Control Panel",
  "controlPanel.ready": "Ready",
  "controlPanel.listening": "Listening...",
  "controlPanel.processing": "Processing...",
  "controlPanel.quickStart": "Quick Start",
  "controlPanel.quickStartDesc":
    "Press {hotkey} to start dictating anywhere. Your speech will be transcribed and pasted at your cursor.",
  "controlPanel.quickStart.step1": "Click in any text field",
  "controlPanel.quickStart.step2": "Press {hotkey} to start recording",
  "controlPanel.quickStart.step3": "Speak your text",
  "controlPanel.quickStart.step4": "Press {hotkey} again to stop",
  "controlPanel.quickStart.step5": "Your text will appear automatically!",
  "controlPanel.history": "History",
  "controlPanel.settings": "Settings",
  "controlPanel.emptyHistory": "No transcriptions yet",
  "controlPanel.emptyHistoryDesc":
    "Your transcription history will appear here once you start dictating.",
  "controlPanel.clearAll": "Clear All",
  "controlPanel.clearAllConfirm":
    "Are you sure you want to clear all transcription history? This cannot be undone.",
  "controlPanel.installUpdateConfirm":
    "The app will close to install the update. Make sure to save any work first.",
  "controlPanel.updateReady": "Update Ready",
  "controlPanel.updateReadyDesc": "Click 'Install Update' to restart and apply the update.",
  "controlPanel.updateError": "Failed to update. Please try again later.",
  "controlPanel.loadError": "Unable to load history",
  "controlPanel.loadErrorDesc": "Please try again in a moment.",
  "controlPanel.copiedDesc": "Text copied to your clipboard",
  "controlPanel.copyFailed": "Copy Failed",
  "controlPanel.copyFailedDesc": "Failed to copy text to clipboard",
  "controlPanel.clearHistory": "Clear History",
  "controlPanel.historyCleared": "History Cleared",
  "controlPanel.clearedCount": "Successfully cleared transcriptions:",
  "controlPanel.clearFailed": "Failed to clear history. Please try again.",
  "controlPanel.deleteTranscription": "Delete Transcription",
  "controlPanel.deleteConfirm": "Are you sure you want to remove this transcription?",
  "controlPanel.deleteFailed": "Delete Failed",
  "controlPanel.deleteFailedDesc":
    "Failed to delete transcription. It may have already been removed.",
  "controlPanel.deleteFailedRetry": "Failed to delete transcription. Please try again.",
  "controlPanel.installFailedDesc": "Failed to install update. Please try again.",
  "controlPanel.downloadFailedDesc": "Failed to download update. Please try again.",
  "controlPanel.installing": "Installing...",

  // Window Controls
  "window.minimize": "Minimize",
  "window.maximize": "Maximize",
  "window.restore": "Restore",
  "window.close": "Close",
  "window.quit": "Quit",
  "window.quitConfirm": "Quit Application?",
  "window.quitDesc": "Are you sure you want to quit TypeFree?",

  // Toast Messages
  "toast.hotkeyChanged": "Hotkey changed to {hotkey}",
  "toast.hotkeyUnavailable": "Hotkey unavailable",
  "toast.copied": "Copied to clipboard",
  "toast.deleted": "Transcription deleted",
  "toast.saved": "Saved",
  "toast.error": "An error occurred",

  // Dialogs
  "dialog.confirm": "Confirm",
  "dialog.cancel": "Cancel",
  "dialog.ok": "OK",
  "dialog.delete": "Delete",
  "dialog.clear": "Clear",
  "dialog.save": "Save",
  "dialog.reset": "Reset",
  "dialog.noUpdates": "You're up to date!",
  "dialog.updateCheckFailed": "Update check failed",
  "dialog.downloadFailed": "Download failed",
  "dialog.installFailed": "Install failed",
  "dialog.installingUpdate": "Installing Update",
  "dialog.installingDesc": "TypeFree will restart shortly...",
  "dialog.deleteModel": "Delete Model",
  "dialog.deleteModelDesc":
    "Are you sure you want to delete this model? You'll need to re-download it if you want to use it again.",

  // Common
  "common.loading": "Loading...",
  "common.error": "Error",
  "common.success": "Success",
  "common.optional": "Optional",
  "common.required": "Required",
  "common.enabled": "Enabled",
  "common.disabled": "Disabled",
  "common.custom": "Custom",
  "common.reset": "Reset",
  "common.refresh": "Refresh",

  "common.applyRefresh": "Apply & Refresh",
  "common.selected": "Selected",
  "common.recommended": "Recommended",
  "common.size": "Size",
  "common.select": "Select",
  "common.processing": "Processing...",

  // Reasoning
  "reasoning.enable": "Enable AI Text Enhancement",
  "reasoning.enableDesc": "Use AI to automatically improve transcription quality",
  "reasoning.cloudAI": "Cloud AI",
  "reasoning.powerful": "Powerful",
  "reasoning.cloudDesc": "Advanced models via API. Fast and capable, requires internet.",
  "reasoning.localAI": "Local AI",
  "reasoning.private": "Private",
  "reasoning.localDesc": "Runs on your device. Complete privacy, works offline.",
  "reasoning.availableModels": "Available Models",
  "reasoning.queryingModels": "We'll query {url} for available models.",
  "reasoning.reloadInfo":
    'Models will reload when you click away from the URL field or click "Apply & Refresh".',
  "reasoning.enterUrlInfo": "Enter an endpoint URL above to load models.",
  "reasoning.fetchingModels": "Fetching model list from endpoint...",
  "reasoning.noModels": "No models returned. Check your endpoint URL.",
  "reasoning.endpointUrl": "Endpoint URL",
  "reasoning.apiKey": "API Key",
  "reasoning.selectModel": "Select Model",
  "reasoning.getKey": "Get your API key →",
  "reasoning.download": "Download",

  "reasoning.downloading": "Downloading...",
  "reasoning.noModelsAvailable": "No models available for this provider",
  "reasoning.noModelSelected": "No reasoning model selected.",
  "reasoning.setDefaultModel": "Set as Default",
  "reasoning.defaultModel": "Default",
  "reasoning.defaultModelSet": "Default model updated.",
  "reasoning.baseUrlMissing": "{provider} base URL missing.",

  // Settings - General
  "settings.general": "General",
  "settings.transcription": "Transcription",
  "settings.clipboard": "Clipboard",
  "settings.aiModels": "AI Models",
  "settings.promptStudio": "Prompt Studio",
  "settings.agentConfig": "Agent Config",
  "settings.developer": "Developer",
  "settings.clipboard.desc": "Manage clipboard history and favorites.",

  // Clipboard
  "clipboard.history": "History",
  "clipboard.favorites": "Favorites",
  "clipboard.enable": "Enable clipboard history",
  "clipboard.maxItems": "Max items",
  "clipboard.search": "Search",
  "clipboard.searchPlaceholder": "Search clipboard...",
  "clipboard.noResults": "No matches found.",
  "clipboard.clearHistory": "Clear history",
  "clipboard.folderName": "Folder name",
  "clipboard.addFolder": "Add folder",
  "clipboard.create": "Create",
  "clipboard.cancel": "Cancel",
  "clipboard.copy": "Copy",
  "clipboard.paste": "Paste",
  "clipboard.pin": "Pin",
  "clipboard.unpin": "Unpin",
  "clipboard.empty": "No clipboard items yet.",
  "clipboard.addToFolder": "Add to folder",
  "clipboard.noFolder": "No folder",
  "clipboard.newFolder": "New folder",
  "clipboard.editFolders": "Edit folders",
  "clipboard.deleteFolder": "Delete folder",
  "clipboard.ok": "OK",
  "settings.appUpdates": "App Updates",
  "settings.appUpdates.desc": "Check for and install new versions of TypeFree.",
  "settings.currentVersion": "Current Version",
  "settings.loading": "Loading...",
  "settings.devMode": "Dev Mode",
  "settings.updateAvailable": "Update Available",
  "settings.upToDate": "Up to Date",
  "settings.checkingUpdates": "Checking...",
  "settings.checkUpdates": "Check for Updates",
  "settings.downloading": "Downloading...",
  "settings.downloadUpdate": "Download Update",
  "settings.downloaded": "downloaded",
  "settings.installUpdate": "Install Update",
  "settings.installRestart": "Install & Restart",
  "settings.restarting": "Restarting...",
  "settings.quitInstall": "Quit & Install Update",
  "settings.released": "Released",
  "settings.whatsNew": "What's New",
  "settings.update.manualRestartTitle": "Still Running",
  "settings.update.manualRestartDesc":
    "TypeFree didn't restart automatically. Please quit the app manually to finish installing the update.",

  // UI Language
  "settings.uiLanguage.label": "App Language",
  "settings.uiLanguage.help": "Changes the UI language (restart may be required).",

  // Startup
  "settings.launchAtStartup.title": "Startup",
  "settings.launchAtStartup.desc":
    "Control whether TypeFree launches automatically when you sign in.",
  "settings.launchAtStartup.label": "Launch at startup",
  "settings.launchAtStartup.help": "Start TypeFree automatically after login.",
  "settings.launchAtStartup.errorTitle": "Autostart Failed",
  "settings.launchAtStartup.errorDesc": "Unable to update autostart setting. Please try again.",

  // Dictation hotkey
  "settings.dictationHotkey": "Dictation Hotkey",
  "settings.dictationHotkey.desc":
    "Configure the key or key combination used to start and stop voice dictation.",
  "settings.dictationTriggerMode": "Dictation Trigger",
  "settings.dictationTriggerMode.desc":
    "Choose whether dictation starts with one press or a quick double-press of the dictation hotkey.",
  "settings.dictationTriggerMode.error":
    "Failed to apply the dictation trigger mode. Please try a different hotkey or mode.",
  "settings.singlePress": "Single Press",
  "settings.doublePress": "Double Press",
  "settings.clipboardHotkey": "Clipboard Double-Press Key",
  "settings.clipboardHotkey.desc":
    "Set one separate key for the clipboard panel. Press the same key twice quickly to open clipboard history only.",
  "settings.singleKeyWarning":
    "Single-key global hotkeys may block normal typing of that key while Typefree is running.",
  "settings.activationMode": "Activation Mode",
  "settings.tapToTalk": "Tap to Talk",
  "settings.tapOnOff": "Tap to start, tap to stop",
  "settings.pushToTalk": "Push to Talk",
  "settings.holdToRecord": "Hold to record",
  "settings.tapModeDesc": "Press hotkey to start recording, press again to stop",
  "settings.pushModeDesc": "Hold hotkey to talk, release to process",
  "settings.doublePressOnlyTap":
    "Double-press dictation works only with Tap to Talk, so Push to Talk is disabled.",

  // Permissions
  "settings.permissions": "Permissions",
  "settings.permissions.desc": "Manage system permissions for optimal performance functionality.",
  "settings.permissions.check": "Check Permissions",
  "settings.permissions.resetTitle": "Reset Accessibility Permissions",
  "settings.permissions.resetDesc":
    "🔄 RESET ACCESSIBILITY PERMISSIONS\n\nIf you've rebuilt or reinstalled TypeFree and automatic inscription isn't functioning, you may have obsolete permissions from the previous version.\n\n📋 STEP-BY-STEP RESTORATION:\n\n1️⃣ Open System Settings\n2️⃣ Navigate to Privacy & Security → Accessibility\n3️⃣ Remove obsolete TypeFree entries\n4️⃣ Add the current TypeFree app\n5️⃣ Restart the application\n\n💡 This is common during development!\n\nClick OK when ready to open System Settings.",
  "settings.permissions.openingTitle": "Opening System Settings",
  "settings.permissions.openingDesc":
    "Opening System Settings... Look for the Accessibility section under Privacy & Security.",

  // Microphone Settings
  "settings.microphone.preferBuiltIn": "Prefer Built-in Microphone",
  "settings.microphone.preferBuiltInDesc":
    "External microphones may cause latency or reduced transcription quality",
  "settings.microphone.using": "Using: ",
  "settings.microphone.noBuiltIn": "No built-in microphone detected. Using system default.",
  "settings.microphone.inputDevice": "Input Device",
  "settings.microphone.selectPlaceholder": "Select a microphone",
  "settings.microphone.systemDefault": "System Default",
  "settings.microphone.unknownDevice": "Unknown Device",
  "settings.microphone.builtInLabel": "(Built-in)",
  "settings.microphone.selectDesc":
    "Select a specific microphone or use the system default setting.",
  "settings.microphone.accessError": "Unable to access microphone. Please check permissions.",

  // Transcription Picker
  "transcription.customEndpoint.title": "Custom Endpoint Configuration",
  "transcription.customEndpoint.desc": "Connect to any OpenAI-compatible transcription API.",
  "transcription.endpointUrl": "Endpoint URL",
  "transcription.examples": "Examples:",
  "transcription.providerDetection":
    "Known providers (AssemblyAI, Groq, OpenAI, Z.ai) will be auto-detected.",
  "transcription.apiKeyOptional": "API Key (Optional)",
  "transcription.apiKeyHelp": "Optional. Sent as a Bearer token for authentication.",
  "transcription.modelName": "Model Name",
  "transcription.modelNameDesc":
    "The model name supported by your endpoint (defaults to whisper-1).",
  "transcription.selectModel": "Select Model",
  "transcription.apiKey": "API Key",
  "transcription.getKey": "Get your API key →",
  "transcription.prompt.title": "Transcription Prompt",
  "transcription.prompt.desc":
    "Guide how the speech-to-text model should recognize names, jargon, and expected wording.",
  "transcription.prompt.placeholder":
    "Example: Product names include Typefree, AssemblyAI, Z.ai, and Tauri.",
  "transcription.prompt.assemblyaiOnly":
    "Only sent when the selected AssemblyAI model is Universal-3 Pro.",
  "transcription.prompt.assemblyaiActive":
    "This prompt will be sent with AssemblyAI Universal-3 Pro transcription requests.",
  "transcription.prompt.save": "Save Prompt",
  "transcription.prompt.saved": "Saved",
  "transcription.prompt.reset": "Reset",
  "transcription.cleanupPrompt.title": "Text Cleanup Prompt",
  "transcription.cleanupPrompt.desc":
    "Edit how the AI polishes transcript text after speech recognition. This uses the same prompt as Prompt Studio.",
  "transcription.cleanupPrompt.placeholder": "Customize how transcript cleanup should behave...",
  "transcription.testConnection.button": "Check Connection",
  "transcription.testConnection.checking": "Checking...",
  "transcription.testConnection.success": "Connection successful!",
  "transcription.testConnection.failed": "Connection failed",
  "transcription.testConnection.error": "Connection error",
  "transcription.testConnection.missingFields": "Please fill in Endpoint URL and Model Name",

  "transcription.setDefaultModel": "Set as Default",
  "transcription.defaultModel": "Default",
  "transcription.defaultModelSet": "Default transcription model updated.",

  "settings.testMicPermission": "Test Microphone Permission",
  "settings.testAccessibility": "Test Accessibility Permission",
  "settings.fixPermissions": "Fix Permission Issues",

  // Microphone
  "settings.microphoneInput": "Microphone Input",
  "settings.microphoneInput.desc":
    "Select the microphone used for dictation. Enable 'Prefer Built-in Microphone' to prevent audio interruptions with Bluetooth headphones.",

  // About
  "settings.about": "About TypeFree",
  "settings.about.desc":
    "TypeFree uses AI to convert your speech to text. Press the hotkey and speak, and we'll type what you say at your cursor.",
  "settings.defaultHotkey": "Default Hotkey",
  "settings.version": "Version",
  "settings.status": "Status",
  "settings.active": "Active",
  "settings.cleanupData": "Clean Up All App Data",
  "settings.cleanupWarning":
    "This will permanently delete all TypeFree data, including:\n\n• Database and transcription records\n• Local storage settings\n• Downloaded AI models\n• Environment configuration\n\nYou'll need to manually revoke app permissions in System Settings.\n\nThis action cannot be undone. Are you sure?",
  "settings.cleanupDanger": "⚠️ Danger: Clean Up App Data",
  "settings.cleanupCompleted": "Cleanup Completed",
  "settings.cleanupSuccess": "✅ Cleanup complete! All app data has been removed.",
  "settings.cleanupFailed": "Cleanup Failed",

  // Transcription
  "settings.speechToText": "Speech-to-Text Processing",
  "settings.speechToText.desc": "Select the cloud provider used for speech-to-text transcription.",

  // AI Models
  "settings.aiEnhancement": "AI Text Enhancement",
  "settings.aiEnhancement.desc":
    "Configure how AI models clean up and format your transcriptions. Supports handling 'delete that' commands, creating proper lists, fixing obvious errors, while preserving your natural voice.",

  // Agent Config
  "settings.agentConfig.title": "Agent Configuration",
  "settings.agentConfig.desc":
    "Customize your AI assistant's name and behavior for more personalized and efficient interactions.",
  "settings.agentConfig.howTo": "💡 How to use your agent name:",
  "settings.agentConfig.tip1":
    "Say 'Hey {agentName}, write a formal email' to give specific instructions",
  "settings.agentConfig.tip2": "Use 'Hey {agentName}, format this as a list' to enhance text",
  "settings.agentConfig.tip3":
    "The agent recognizes when you're talking directly to it vs dictating",
  "settings.agentConfig.tip4":
    "Makes conversations feel natural and helps distinguish commands from dictation",
  "settings.currentAgentName": "Current Agent Name",
  "settings.agentNamePlaceholder": "e.g., Assistant, Jarvis, Siri...",
  "settings.save": "Save",
  "settings.agentConfig.exampleTitle": "🎯 Example Usage:",
  "settings.agentConfig.example1": "Hey {agentName}, write an email to my team about the meeting",
  "settings.agentConfig.example2": "Hey {agentName}, make this more professional",
  "settings.agentConfig.example3": "Hey {agentName}, convert this to bullet points",
  "settings.agentConfig.example4":
    'Regular dictation: "This is just normal text" (no agent name needed)',
  "settings.agentConfig.inputPlaceholder": "e.g., Assistant, Jarvis, Alex...",
  "settings.agentConfig.saveName": "Agent Name Updated",
  "settings.agentConfig.saveNameDesc":
    'Your agent is now named "{name}". You can address it by saying "Hey {name}" followed by your instructions.',
  "settings.agentConfig.nameAdvice": "Choose a name that feels natural to say and remember",

  // Developer
  "developer.title": "Developer Tools",
  "developer.troubleshooting": "Troubleshooting",
  "developer.debugLogging": "Debug Logging",
  "developer.debugLoggingDesc": "Enable detailed logging for troubleshooting issues.",
  "developer.openLogsFolder": "Open Logs Folder",
  "developer.logsInstructions":
    "When reporting issues, please include logs from the folder above. Logs contain technical details but no personal content.",
  "developer.cardDesc":
    "Captures detailed logs of audio processing, transcription, and system operations. Enable this when experiencing issues to help diagnose problems.",
  "developer.enableDebug": "Enable Debug Mode",
  "developer.disableDebug": "Disable Debug Mode",
  "developer.enabling": "Enabling...",
  "developer.disabling": "Disabling...",
  "developer.active": "Active",
  "developer.inactive": "Inactive",
  "developer.currentLogFile": "Current Log File",
  "developer.copyLogPath": "Copy log path",
  "developer.howToShare": "How to Share Logs for Support",
  "developer.shareDesc": "To help us diagnose your issue:",
  "developer.shareStep1": "Reproduce the issue while debug mode is enabled",
  "developer.shareStep2": 'Click "Open Logs Folder" above',
  "developer.shareStep3": "Find the most recent log file (sorted by date)",
  "developer.shareStep4": "Attach the log file to your bug report or support email",
  "developer.sharePrivacy": "Your logs don't contain API keys or sensitive data",
  "developer.whatLogged": "What Gets Logged",
  "developer.log.audio": "Audio processing",
  "developer.log.api": "API requests",
  "developer.log.ffmpeg": "FFmpeg operations",
  "developer.log.system": "System diagnostics",
  "developer.log.pipeline": "Transcription pipeline",
  "developer.log.error": "Error details",
  "developer.perfNote": "Performance Note",
  "developer.perfNoteDesc":
    "Debug logging writes detailed information to disk and may have a minor impact on app performance. Disable it when not troubleshooting.",

  // Prompt Studio
  "promptStudio.title": "Prompt Studio",
  "promptStudio.desc":
    "Customize how AI processes your speech. This powerful feature lets you control formatting, style, and output structure.",
  "promptStudio.current": "Current",
  "promptStudio.customize": "Customize",
  "promptStudio.test": "Test",
  "promptStudio.howItWorks": "How it works:",
  "promptStudio.howItWorksDesc":
    "The prompt tells the AI how to clean up your speech. It runs after transcription to format, correct, and polish your text.",
  "promptStudio.cleanupMode": "Cleanup Mode:",
  "promptStudio.cleanupModeDesc":
    "Remove filler words, fix grammar, and format properly while keeping your natural voice.",
  "promptStudio.agentMode": "Agent Mode:",
  "promptStudio.agentModeDesc":
    "When you address the agent by name (e.g., 'Hey {agentName}'), it follows your instructions to transform the text.",
  "promptStudio.editablePrompt": "Editable Prompt",
  "promptStudio.editablePromptDesc":
    "Modify the prompt below to change how your transcriptions are processed.",
  "promptStudio.saveChanges": "Save Changes",
  "promptStudio.resetDefault": "Reset to Default",
  "promptStudio.testPlayground": "Test Playground",
  "promptStudio.testPlaygroundDesc":
    "Try out your prompt with sample text to see results in real-time.",
  "promptStudio.sampleText": "Sample Text",
  "promptStudio.sampleTextPlaceholder": "Enter sample text here to test your prompt...",
  "promptStudio.runTest": "Run Test",
  "promptStudio.testing": "Testing...",
  "promptStudio.result": "Result",
  "promptStudio.currentPromptTitle": "Current System Prompt",
  "promptStudio.currentPromptDesc":
    "This is the exact prompt sent to your AI model. It handles both text cleanup and instruction detection in a single, unified approach.",
  "promptStudio.unifiedPrompt": "Unified System Prompt",
  "promptStudio.intelligentDetection":
    "The AI intelligently detects which mode to use based on context",
  "promptStudio.copyPrompt": "Copy Prompt",
  "promptStudio.customizeTitle": "Customize System Prompt",
  "promptStudio.customizeDesc":
    "Edit the system prompt to change how your AI processes speech. Use {{agentName}} as a placeholder for your agent's name.",
  "promptStudio.cautionDesc":
    "Caution: Modifying this prompt may affect transcription quality. The default prompt has been carefully crafted for optimal results.",
  "promptStudio.systemPrompt": "System Prompt",
  "promptStudio.placeholder": "Enter your custom system prompt...",
  "promptStudio.agentNameIs": "Your agent name is:",
  "promptStudio.saveCustom": "Save Custom Prompt",
  "promptStudio.testTitle": "Test Your Prompt",
  "promptStudio.testDesc":
    "Test how the AI processes different types of input. Try both regular dictation and addressing your agent directly.",
  "promptStudio.aiDisabled": "AI Text Enhancement Disabled",
  "promptStudio.aiDisabledDesc":
    "Enable AI text enhancement in the AI Text Cleanup settings to test prompts.",
  "promptStudio.currentModel": "Current Model",
  "promptStudio.provider": "Provider",
  "promptStudio.endpoint": "Endpoint",
  "promptStudio.testInput": "Test Input",
  "promptStudio.testPlaceholder": "Enter text to test...",
  "promptStudio.tryCleanup":
    'Try: "um so like I think we should uh schedule a meeting" (cleanup mode)',
  "promptStudio.tryInstruction":
    'Try: "Hey {agentName}, make this more formal: gonna send the report tomorrow" (instruction mode)',
  "promptStudio.activeInstruction": "May trigger instruction mode",
  "promptStudio.activeCleanup": "Cleanup mode",
  "promptStudio.aiOutput": "AI Output",
  "promptStudio.alert.savedTitle": "Prompt Saved!",
  "promptStudio.alert.savedDesc":
    "Your custom prompt has been saved and will be used for all future AI processing.",
  "promptStudio.alert.resetTitle": "Reset Complete",
  "promptStudio.alert.resetDesc": "Prompt has been reset to the default value.",
  "promptStudio.alert.copied": "Copied!",
  "promptStudio.alert.copiedDesc": "Prompt copied to clipboard.",
  "promptStudio.alert.testFailed": "Test failed",

  // Reasoning Model Selector

  // Transcription Item
  "transcriptionItem.copy": "Copy",
  "transcriptionItem.delete": "Delete",
  "transcriptionItem.original": "Original",
  "transcriptionItem.processed": "Processed",

  // Support
  "support.title": "Support",
  "support.contactSupport": "Contact Support",
  "support.submitBug": "Submit a Bug Report",

  // Onboarding
  "onboarding.steps.welcome": "Welcome",
  "onboarding.steps.setup": "Setup",
  "onboarding.steps.permissions": "Permissions",
  "onboarding.steps.hotkey": "Hotkey & Test",
  "onboarding.steps.agent": "Agent Name",

  "onboarding.welcome.title": "Welcome to TypeFree",
  "onboarding.welcome.desc": "Let's set up your voice dictation in just a few simple steps.",
  "onboarding.welcome.feature1": "🎤 Turn your voice into text instantly",
  "onboarding.welcome.feature2": "⚡ Works anywhere on your computer",
  "onboarding.welcome.feature3": "🔒 Your privacy is protected",

  "onboarding.setup.title": "Setup Your Transcription",
  "onboarding.setup.desc": "Configure your cloud transcription provider",
  "onboarding.setup.languageTitle": "🌍 Preferred Language",
  "onboarding.setup.languageLabel": "Which language do you primarily speak?",
  "onboarding.setup.languageHelp":
    "Improves transcription speed and accuracy. AI text enhancement is enabled by default.",

  "onboarding.permissions.title": "Grant Permissions",
  "onboarding.permissions.desc.mac": "TypeFree needs a couple of permissions to work properly",
  "onboarding.permissions.desc.win": "TypeFree needs microphone access to record your voice",
  "onboarding.permissions.micTitle": "Microphone Access",
  "onboarding.permissions.micDesc": "Required to record your voice",
  "onboarding.permissions.grant": "Grant Access",
  "onboarding.permissions.accessibilityTitle": "Accessibility Permission",
  "onboarding.permissions.accessibilityDesc": "Required to paste text automatically",
  "onboarding.permissions.testGrant": "Test & Grant",
  "onboarding.permissions.privacyTitle": "🔒 Privacy Note",
  "onboarding.permissions.privacyDesc":
    "TypeFree only uses these permissions for dictation. Your voice is sent to cloud servers for transcription.",

  "onboarding.hotkey.title": "Set Your Hotkey & Test",
  "onboarding.hotkey.desc": "Choose your hotkey and activation style",
  "onboarding.hotkey.activationMode": "Activation Mode",
  "onboarding.hotkey.tryIt": "Try It Now",
  "onboarding.hotkey.instruction.tap":
    "Click in the text area, press {hotkey} to start recording, speak, then press it again to stop.",
  "onboarding.hotkey.instruction.hold":
    "Click in the text area, hold {hotkey} while speaking, then release to process.",
  "onboarding.hotkey.testLabel": "Test your dictation:",
  "onboarding.hotkey.testPlaceholder": "Click here, then use your hotkey to dictate...",

  "onboarding.agent.title": "Name Your Agent",
  "onboarding.agent.desc":
    "Give your agent a name so you can address it specifically when giving instructions.",
  "onboarding.agent.helpTitle": "How this helps:",
  "onboarding.agent.help1":
    '• Say "Hey {agentName}, write a formal email" for specific instructions',
  "onboarding.agent.help2": "• Use the name to distinguish between dictation and commands",
  "onboarding.agent.help3": "• Makes interactions feel more natural and personal",
  "onboarding.agent.inputLabel": "Agent Name",
  "onboarding.agent.inputPlaceholder": "e.g., Assistant, Jarvis, Alex...",
  "onboarding.agent.footer": "You can change this anytime in settings",

  "onboarding.next": "Next",
  "onboarding.prev": "Previous",
  "onboarding.complete": "Complete Setup",

  "onboarding.error.hotkeyTitle": "Hotkey Not Registered",
  "onboarding.error.hotkeyDesc": "We couldn't register that key. Please choose another hotkey.",
  "onboarding.error.generic": "Hotkey Error",
};

/**
 * Chinese (Simplified) translations
 */
const ZH_CN: Record<string, string> = {
  // App-level
  "app.loading": "正在加载 TypeFree...",
  "app.hideForNow": "暂时隐藏",
  "app.startListening": "开始听写",
  "app.stopListening": "停止听写",
  "app.processing": "处理中...",
  "app.recording": "录音中...",
  "app.pressHotkeyToSpeak": "按下 [{hotkey}] 开始说话",
  "app.cancelRecording": "取消录音",
  "app.clickToSpeak": "点击麦克风或按 {hotkey} 开始说话",
  "app.clickOrPress": "点击或按 {hotkey}",
  "app.holdingToRecord": "松开停止",
  "app.hotkeyUnavailableDesc": "无法注册快捷键。请在设置中更改快捷键。",

  // Control Panel
  "controlPanel.title": "TypeFree - 控制面板",
  "controlPanel.ready": "就绪",
  "controlPanel.listening": "正在听取...",
  "controlPanel.processing": "处理中...",
  "controlPanel.quickStart": "快速开始",
  "controlPanel.quickStartDesc":
    "按下 {hotkey} 在任何地方开始听写。您的语音将被转录并粘贴到光标位置。",
  "controlPanel.quickStart.step1": "点击任意文本输入框",
  "controlPanel.quickStart.step2": "按下 {hotkey} 开始录音",
  "controlPanel.quickStart.step3": "说出您的文本",
  "controlPanel.quickStart.step4": "再次按下 {hotkey} 停止",
  "controlPanel.quickStart.step5": "您的文本将自动显示！",
  "controlPanel.history": "历史记录",
  "controlPanel.settings": "设置",
  "controlPanel.emptyHistory": "暂无转录记录",
  "controlPanel.emptyHistoryDesc": "开始听写后，您的转录历史将显示在这里。",
  "controlPanel.clearAll": "清除全部",
  "controlPanel.clearAllConfirm": "确定要清除所有转录历史吗？此操作无法撤销。",
  "controlPanel.installUpdateConfirm": "应用将关闭以安装更新。请先保存您的工作。",
  "controlPanel.updateReady": "更新就绪",
  "controlPanel.updateReadyDesc": "点击「安装更新」重启并应用更新。",
  "controlPanel.updateError": "更新失败，请稍后重试。",
  "controlPanel.loadError": "无法加载历史记录",
  "controlPanel.loadErrorDesc": "请稍后再试。",
  "controlPanel.copiedDesc": "已复制到剪贴板",
  "controlPanel.copyFailed": "复制失败",
  "controlPanel.copyFailedDesc": "无法复制到剪贴板",
  "controlPanel.clearHistory": "清除历史",
  "controlPanel.historyCleared": "历史已清除",
  "controlPanel.clearedCount": "已成功清除转录记录：",
  "controlPanel.clearFailed": "清除历史失败，请重试。",
  "controlPanel.deleteTranscription": "删除转录",
  "controlPanel.deleteConfirm": "确定要删除此转录记录吗？",
  "controlPanel.deleteFailed": "删除失败",
  "controlPanel.deleteFailedDesc": "无法删除转录记录，可能已被移除。",
  "controlPanel.deleteFailedRetry": "删除转录失败，请重试。",
  "controlPanel.installFailedDesc": "安装更新失败，请重试。",
  "controlPanel.downloadFailedDesc": "下载更新失败，请重试。",
  "controlPanel.installing": "安装中...",

  // Window Controls
  "window.minimize": "最小化",
  "window.maximize": "最大化",
  "window.restore": "还原",
  "window.close": "关闭",
  "window.quit": "退出",
  "window.quitConfirm": "退出应用？",
  "window.quitDesc": "确定要退出 TypeFree 吗？",

  // Toast Messages
  "toast.hotkeyChanged": "快捷键已更改为 {hotkey}",
  "toast.hotkeyUnavailable": "快捷键不可用",
  "toast.copied": "已复制到剪贴板",
  "toast.deleted": "转录记录已删除",
  "toast.saved": "已保存",
  "toast.error": "发生错误",

  // Dialogs
  "dialog.confirm": "确认",
  "dialog.cancel": "取消",
  "dialog.ok": "确定",
  "dialog.delete": "删除",
  "dialog.clear": "清除",
  "dialog.save": "保存",
  "dialog.reset": "重置",
  "dialog.noUpdates": "已是最新版本！",
  "dialog.updateCheckFailed": "检查更新失败",
  "dialog.downloadFailed": "下载失败",
  "dialog.installFailed": "安装失败",
  "dialog.installingUpdate": "正在安装更新",
  "dialog.installingDesc": "TypeFree 即将重启...",
  "dialog.deleteModel": "删除模型",
  "dialog.deleteModelDesc": "确定要删除此模型吗？如果您想再次使用它，需要重新下载。",

  // Common
  "common.loading": "加载中...",
  "common.error": "错误",
  "common.success": "成功",
  "common.optional": "可选",
  "common.required": "必填",
  "common.enabled": "已启用",
  "common.disabled": "已禁用",
  "common.custom": "自定义",
  "common.reset": "重置",
  "common.refresh": "刷新",
  "common.applyRefresh": "应用并刷新",
  "common.selected": "已选择",
  "common.recommended": "推荐",
  "common.size": "大小",
  "common.select": "选择",
  "common.processing": "处理中...",

  // Reasoning
  "reasoning.enable": "启用 AI 文本增强",
  "reasoning.enableDesc": "使用 AI 自动提高转录质量",
  "reasoning.cloudAI": "云端 AI",
  "reasoning.powerful": "强大",
  "reasoning.cloudDesc": "通过 API 使用高级模型。速度快且能力强，需要网络。",
  "reasoning.localAI": "本地 AI",
  "reasoning.private": "隐私",
  "reasoning.localDesc": "在您的设备上运行。完全隐私，无需网络。",
  "reasoning.availableModels": "可用模型",
  "reasoning.queryingModels": "我们将查询 {url} 以获取可用模型。",
  "reasoning.reloadInfo": "当您点击 URL 字段之外或点击“应用并刷新”时，模型将重新加载。",
  "reasoning.enterUrlInfo": "在上方输入端点 URL 以加载模型。",
  "reasoning.fetchingModels": "正在从端点获取模型列表...",
  "reasoning.noModels": "未返回任何模型。请检查您的端点 URL。",
  "reasoning.endpointUrl": "端点 URL",
  "reasoning.apiKey": "API Key",
  "reasoning.selectModel": "选择模型",
  "reasoning.getKey": "获取 API key →",
  "reasoning.download": "下载",

  "reasoning.downloading": "下载中...",
  "reasoning.noModelsAvailable": "此提供商无可用模型",
  "reasoning.noModelSelected": "未选择推理模型。",
  "reasoning.baseUrlMissing": "{provider} 基础 URL 缺失。",

  // Settings - General
  "settings.general": "通用",
  "settings.transcription": "语音转写",
  "settings.clipboard": "剪贴板",
  "settings.aiModels": "AI 模型",
  "settings.promptStudio": "提示词工作室",
  "settings.agentConfig": "智能体配置",
  "settings.developer": "开发者",
  "settings.clipboard.desc": "管理剪贴板历史与收藏。",

  // Clipboard
  "clipboard.history": "历史",
  "clipboard.favorites": "收藏",
  "clipboard.enable": "启用剪贴板历史",
  "clipboard.maxItems": "最大条数",
  "clipboard.search": "搜索",
  "clipboard.searchPlaceholder": "搜索剪贴板...",
  "clipboard.noResults": "未找到匹配内容。",
  "clipboard.clearHistory": "清空历史",
  "clipboard.folderName": "文件夹名称",
  "clipboard.addFolder": "添加文件夹",
  "clipboard.create": "创建",
  "clipboard.cancel": "取消",
  "clipboard.copy": "复制",
  "clipboard.paste": "粘贴",
  "clipboard.pin": "收藏",
  "clipboard.unpin": "取消收藏",
  "clipboard.empty": "暂无剪贴板内容。",
  "clipboard.addToFolder": "添加到文件夹",
  "clipboard.noFolder": "无文件夹",
  "clipboard.newFolder": "新建文件夹",
  "clipboard.editFolders": "编辑文件夹",
  "clipboard.deleteFolder": "删除文件夹",
  "clipboard.ok": "确定",
  "settings.appUpdates": "应用更新",
  "settings.appUpdates.desc": "检查并安装 TypeFree 的新版本。",
  "settings.currentVersion": "当前版本",
  "settings.loading": "加载中...",
  "settings.devMode": "开发模式",
  "settings.updateAvailable": "有新版本可用",
  "settings.upToDate": "已是最新",
  "settings.checkingUpdates": "正在检查更新...",
  "settings.checkUpdates": "检查更新",
  "settings.downloading": "下载中...",
  "settings.downloadUpdate": "下载更新",
  "settings.downloaded": "已下载",
  "settings.installUpdate": "安装更新",
  "settings.installRestart": "安装并重启",
  "settings.restarting": "正在重启以完成更新...",
  "settings.quitInstall": "退出并安装更新",
  "settings.released": "发布时间",
  "settings.whatsNew": "更新内容",
  "settings.update.manualRestartTitle": "仍在运行",
  "settings.update.manualRestartDesc": "TypeFree 未能自动重启。请手动退出应用以完成更新安装。",

  // UI Language
  "settings.uiLanguage.label": "界面语言",
  "settings.uiLanguage.help": "更改软件界面语言（可能需要重启生效）。",

  // Startup
  "settings.launchAtStartup.title": "启动",
  "settings.launchAtStartup.desc": "控制 TypeFree 是否在您登录系统后自动启动。",
  "settings.launchAtStartup.label": "开机自启",
  "settings.launchAtStartup.help": "在系统启动/登录后自动运行 TypeFree。",
  "settings.launchAtStartup.errorTitle": "设置失败",
  "settings.launchAtStartup.errorDesc": "无法更新开机自启设置，请稍后重试。",

  // Dictation hotkey
  "settings.dictationHotkey": "听写快捷键",
  "settings.dictationHotkey.desc": "配置用于开始和停止语音听写的按键或组合键。",
  "settings.dictationTriggerMode": "听写触发方式",
  "settings.dictationTriggerMode.desc": "选择按一次触发，或快速按两次听写快捷键触发。",
  "settings.dictationTriggerMode.error": "应用听写触发方式失败，请更换快捷键或重试。",
  "settings.singlePress": "单击触发",
  "settings.doublePress": "双击触发",
  "settings.clipboardHotkey": "剪贴板双击按键",
  "settings.clipboardHotkey.desc":
    "为剪贴板面板设置单独按键。快速按两次同一个按键时，只弹出剪贴板相关页面。",
  "settings.singleKeyWarning": "单键全局热键在 Typefree 运行时，通常会占用这个键，影响正常输入。",
  "settings.activationMode": "激活方式",
  "settings.tapToTalk": "点按说话",
  "settings.tapOnOff": "点击开始，再点击结束",
  "settings.pushToTalk": "按住说话",
  "settings.holdToRecord": "按住录音",
  "settings.tapModeDesc": "按下快捷键开始录音，再按一次停止",
  "settings.pushModeDesc": "按住快捷键说话，松开后处理",
  "settings.doublePressOnlyTap": "听写设置为双击触发时，只能使用点按说话，不能使用按住说话。",

  // Permissions
  "settings.permissions": "权限设置",
  "settings.permissions.desc": "管理系统权限以获得最佳性能功能。",
  "settings.permissions.check": "检查权限",
  "settings.permissions.resetTitle": "重置辅助功能权限",
  "settings.permissions.resetDesc":
    "🔄 重置辅助功能权限\n\n如果您重新构建或重新安装了 TypeFree，且自动输入功能失效，可能是旧版本的权限残留导致的。\n\n📋 修复步骤：\n\n1️⃣ 打开系统设置\n2️⃣ 转到隐私与安全 → 辅助功能\n3️⃣ 移除所有旧的 TypeFree 条目\n4️⃣ 添加当前的 TypeFree 应用\n5️⃣ 重启应用\n\n💡 开发或重装应用时常见此问题！\n\n准备好后点击确定打开系统设置。",
  "settings.permissions.openingTitle": "正在打开系统设置",
  "settings.permissions.openingDesc": "正在打开系统设置... 请在隐私与安全下找到辅助功能部分。",

  // Microphone Settings
  "settings.microphone.preferBuiltIn": "优先使用内置麦克风",
  "settings.microphone.preferBuiltInDesc": "外部麦克风可能会导致延迟或降低转录质量",
  "settings.microphone.using": "正在使用：",
  "settings.microphone.noBuiltIn": "未检测到内置麦克风。使用系统默认设备。",
  "settings.microphone.inputDevice": "输入设备",
  "settings.microphone.selectPlaceholder": "选择麦克风",
  "settings.microphone.systemDefault": "系统默认",
  "settings.microphone.unknownDevice": "未知设备",
  "settings.microphone.builtInLabel": "（内置）",
  "settings.microphone.selectDesc": "选择特定麦克风或使用系统默认设置。",
  "settings.microphone.accessError": "无法访问麦克风。请检查权限。",

  // Transcription Picker
  "transcription.customEndpoint.title": "自定义端点配置",
  "transcription.customEndpoint.desc": "连接到任何兼容OpenAI的转录API。",
  "transcription.endpointUrl": "端点 URL",
  "transcription.examples": "例如：",
  "transcription.providerDetection": "已知提供商（AssemblyAI、Groq、OpenAI、Z.ai）将被自动检测。",
  "transcription.apiKeyOptional": "API Key (可选)",
  "transcription.apiKeyHelp": "可选。作为Bearer令牌发送以进行身份验证。",
  "transcription.modelName": "模型名称",
  "transcription.modelNameDesc": "端点支持的模型名称（默认为 whisper-1）。",
  "transcription.selectModel": "选择模型",
  "transcription.apiKey": "API Key",
  "transcription.getKey": "获取 API key →",
  "transcription.prompt.title": "转录提示词",
  "transcription.prompt.desc": "用于提示语音转文字模型识别专有名词、术语和你预期出现的表达。",
  "transcription.prompt.placeholder": "例如：产品名包括 Typefree、AssemblyAI、Z.ai、Tauri。",
  "transcription.prompt.assemblyaiOnly":
    "会为所有提供商保存，但当前只有 AssemblyAI Universal-3 Pro 会实际发送这个提示词。",
  "transcription.prompt.assemblyaiActive":
    "当前会把这个提示词一起发送给 AssemblyAI Universal-3 Pro 转录请求。",
  "transcription.prompt.save": "保存提示词",
  "transcription.prompt.saved": "已保存",
  "transcription.prompt.reset": "重置",
  "transcription.cleanupPrompt.title": "文字修饰提示词",
  "transcription.cleanupPrompt.desc":
    "编辑语音识别后的文字修饰规则。这里使用的是与提示词工作室相同的后处理提示词。",
  "transcription.cleanupPrompt.placeholder": "自定义转录后文字修饰的处理方式...",
  "transcription.testConnection.button": "检查连接",
  "transcription.testConnection.checking": "检查中...",
  "transcription.testConnection.success": "连接成功！",
  "transcription.testConnection.failed": "连接失败",
  "transcription.testConnection.error": "连接错误",
  "transcription.testConnection.missingFields": "请填写端点 URL 和模型名称",

  "transcription.setDefaultModel": "设为默认",
  "transcription.defaultModel": "默认",
  "transcription.defaultModelSet": "默认转写模型已更新。",

  "settings.testMicPermission": "测试麦克风权限",
  "settings.testAccessibility": "测试辅助功能权限",
  "settings.fixPermissions": "修复权限问题",

  // Microphone
  "settings.microphoneInput": "麦克风输入",
  "settings.microphoneInput.desc":
    "选择用于听写的麦克风。启用'优先使用内置麦克风'可防止使用蓝牙耳机时音频中断。",

  // About
  "settings.about": "关于 TypeFree",
  "settings.about.desc":
    "TypeFree 使用 AI 将您的语音转换为文字。按下快捷键说话，我们会在光标所在位置输入您说的内容。",
  "settings.defaultHotkey": "默认快捷键",
  "settings.version": "版本",
  "settings.status": "状态",
  "settings.active": "运行中",
  "settings.cleanupData": "清理所有应用数据",
  "settings.cleanupWarning":
    "这将永久删除所有 TypeFree 数据，包括：\n\n• 数据库和转写记录\n• 本地存储设置\n• 已下载的 AI 模型\n• 环境配置文件\n\n您需要在系统设置中手动移除应用权限。\n\n此操作无法撤销，确定继续吗？",
  "settings.cleanupDanger": "⚠️ 危险：清理应用数据",
  "settings.cleanupCompleted": "清理完成",
  "settings.cleanupSuccess": "✅ 清理完成！所有应用数据已被移除。",
  "settings.cleanupFailed": "清理失败",

  // Transcription
  "settings.speechToText": "语音转文字处理",
  "settings.speechToText.desc": "选择用于语音转文字的云服务提供商。",

  // AI Models
  "settings.aiEnhancement": "AI 文本增强",
  "settings.aiEnhancement.desc":
    "配置 AI 模型如何清理和格式化您的转写内容。支持处理'删除这个'等指令，创建正确的列表，修复明显的错误，同时保留您的自然语气。",

  // Agent Config
  "settings.agentConfig.title": "智能体配置",
  "settings.agentConfig.desc": "自定义您的 AI 助手名称和行为，使交互更加个性化和高效。",
  "settings.agentConfig.howTo": "💡 如何使用智能体名称：",
  "settings.agentConfig.tip1": "说'嘿 {agentName}，写一封正式的邮件'来给出具体指令",
  "settings.agentConfig.tip2": "使用'嘿 {agentName}，将这个格式化为列表'来增强文本",
  "settings.agentConfig.tip3": "智能体会识别您是在直接与它对话还是在听写内容",
  "settings.agentConfig.tip4": "使对话更自然，帮助区分指令和听写",
  "settings.currentAgentName": "当前智能体名称",
  "settings.agentNamePlaceholder": "例如：助手、贾维斯、小智...",
  "settings.save": "保存",
  "settings.agentConfig.exampleTitle": "🎯 示例用法：",
  "settings.agentConfig.example1": "嘿 {agentName}，给我的团队写一封关于会议的邮件",
  "settings.agentConfig.example2": "嘿 {agentName}，让这段话更专业一点",
  "settings.agentConfig.example3": "嘿 {agentName}，把这个转换为列表",
  "settings.agentConfig.example4": "普通听写：“这只是普通文本”（无需呼唤智能体名称）",
  "settings.agentConfig.inputPlaceholder": "例如：Assistant, Jarvis, Alex...",
  "settings.agentConfig.saveName": "智能体名称已更新",
  "settings.agentConfig.saveNameDesc":
    "您的智能体现在名为“{name}”。您可以通过说“嘿 {name}”并接指令来呼唤它。",
  "settings.agentConfig.nameAdvice": "选择一个读起来自然且容易记住的名字",

  // Developer
  "developer.title": "开发者工具",
  "developer.troubleshooting": "故障排除",
  "developer.debugLogging": "调试日志",
  "developer.debugLoggingDesc": "启用详细的日志记录以帮助排查问题。",
  "developer.openLogsFolder": "打开日志文件夹",
  "developer.logsInstructions":
    "报告问题时，请包含上述文件夹中的日志。日志包含技术细节，但不包含个人内容。",
  "developer.cardDesc": "记录音频处理、转录和系统操作的详细日志。遇到问题时启用此功能以帮助诊断。",
  "developer.enableDebug": "启用调试模式",
  "developer.disableDebug": "禁用调试模式",
  "developer.enabling": "正在启用...",
  "developer.disabling": "正在禁用...",
  "developer.active": "已激活",
  "developer.inactive": "未激活",
  "developer.currentLogFile": "当前日志文件",
  "developer.copyLogPath": "复制日志路径",
  "developer.howToShare": "如何分享支持日志",
  "developer.shareDesc": "为了帮助我们诊断您的问题：",
  "developer.shareStep1": "在启用调试模式时重现问题",
  "developer.shareStep2": "点击上方的“打开日志文件夹”",
  "developer.shareStep3": "找到最新的日志文件（按日期排序）",
  "developer.shareStep4": "将日志文件附在您的问题报告或支持邮件中",
  "developer.sharePrivacy": "您的日志不包含 API 密钥或敏感数据",
  "developer.whatLogged": "日志记录内容",
  "developer.log.audio": "音频处理",
  "developer.log.api": "API 请求",
  "developer.log.ffmpeg": "FFmpeg 操作",
  "developer.log.system": "系统诊断",
  "developer.log.pipeline": "转录流程",
  "developer.log.error": "错误详情",
  "developer.perfNote": "性能提示",
  "developer.perfNoteDesc":
    "调试日志会将详细信息写入磁盘，可能会对应用性能产生轻微影响。非故障排除期间请禁用。",

  // Prompt Studio
  "promptStudio.title": "提示词工作室",
  "promptStudio.desc": "自定义 AI 处理您语音的方式。这一强大功能让您可以控制格式、风格和输出结构。",
  "promptStudio.current": "当前",
  "promptStudio.customize": "自定义",
  "promptStudio.test": "测试",
  "promptStudio.howItWorks": "工作原理：",
  "promptStudio.howItWorksDesc":
    "提示词告诉 AI 如何清理您的语音。它在转录后运行，对文本进行格式化、纠正和润色。",
  "promptStudio.cleanupMode": "清理模式：",
  "promptStudio.cleanupModeDesc": "去除填充词，修正语法，正确格式化，同时保留您的自然语气。",
  "promptStudio.agentMode": "智能体模式：",
  "promptStudio.agentModeDesc":
    "当您以名字呼唤智能体时（例如'嘿 {agentName}'），它会按照您的指令转换文本。",
  "promptStudio.editablePrompt": "可编辑提示词",
  "promptStudio.editablePromptDesc": "修改下方提示词以更改转录内容的处理方式。",
  "promptStudio.result": "结果",
  "promptStudio.currentPromptTitle": "当前系统提示词",
  "promptStudio.currentPromptDesc":
    "这是发送给 AI 模型的准确提示词。它采用统一的方法同时处理文本清理和指令检测。",
  "promptStudio.unifiedPrompt": "统一系统提示词",
  "promptStudio.intelligentDetection": "AI 会根据上下文智能检测使用哪种模式",
  "promptStudio.copyPrompt": "复制提示词",
  "promptStudio.customizeTitle": "自定义系统提示词",
  "promptStudio.customizeDesc":
    "编辑系统提示词以更改 AI 处理语音的方式。使用 {{agentName}} 作为您智能体名称的占位符。",
  "promptStudio.cautionDesc":
    "注意：修改此提示词可能会影响转录质量。默认提示词经过精心设计以获得最佳结果。",
  "promptStudio.systemPrompt": "系统提示词",
  "promptStudio.placeholder": "输入您的自定义系统提示词...",
  "promptStudio.agentNameIs": "您的智能体名称：",
  "promptStudio.saveCustom": "保存自定义提示词",
  "promptStudio.testTitle": "测试您的提示词",
  "promptStudio.testDesc": "测试 AI 如何处理不同类型的输入。尝试普通听写和直接呼唤您的智能体。",
  "promptStudio.aiDisabled": "AI 文本增强已禁用",
  "promptStudio.aiDisabledDesc": "在 AI 文本清理设置中启用 AI 文本增强以测试提示词。",
  "promptStudio.currentModel": "当前模型",
  "promptStudio.provider": "提供商",
  "promptStudio.endpoint": "端点",
  "promptStudio.testInput": "测试输入",
  "promptStudio.testPlaceholder": "输入文本进行测试...",
  "promptStudio.tryCleanup": "尝试：“呃，所以我觉得我们应该呃安排一个会议”（清理模式）",
  "promptStudio.tryInstruction": "尝试：“嘿 {agentName}，让这段话更正式：明天发报告”（指令模式）",
  "promptStudio.activeInstruction": "可能会触发指令模式",
  "promptStudio.activeCleanup": "清理模式",
  "promptStudio.aiOutput": "AI 输出",
  "promptStudio.alert.savedTitle": "提示词已保存！",
  "promptStudio.alert.savedDesc": "您的自定义提示词已保存，并将用于所有未来的 AI 处理。",
  "promptStudio.alert.resetTitle": "重置完成",
  "promptStudio.alert.resetDesc": "提示词已重置为默认值。",
  "promptStudio.alert.copied": "已复制！",
  "promptStudio.alert.copiedDesc": "提示词已复制到剪贴板。",
  "promptStudio.alert.testFailed": "测试失败",
  "promptStudio.resetDefault": "恢复默认",
  "promptStudio.testPlayground": "测试面板",
  "promptStudio.testPlaygroundDesc": "使用示例文本测试您的提示词，实时查看结果。",
  "promptStudio.sampleText": "示例文本",
  "promptStudio.sampleTextPlaceholder": "在此输入示例文本以测试您的提示词...",
  "promptStudio.runTest": "运行测试",
  "promptStudio.testing": "测试中...",

  // Transcription Item
  "transcriptionItem.copy": "复制",
  "transcriptionItem.delete": "删除",
  "transcriptionItem.original": "原文",
  "transcriptionItem.processed": "处理后",

  // Support
  "support.title": "支持",
  "support.contactSupport": "联系技术支持",
  "support.submitBug": "提交问题报告",

  // Onboarding
  "onboarding.steps.welcome": "欢迎",
  "onboarding.steps.setup": "设置",
  "onboarding.steps.permissions": "权限",
  "onboarding.steps.hotkey": "快捷键与测试",
  "onboarding.steps.agent": "智能体名称",

  "onboarding.welcome.title": "欢迎使用 TypeFree",
  "onboarding.welcome.desc": "让我们通过几个简单的步骤设置您的语音听写。",
  "onboarding.welcome.feature1": "🎤 瞬间将语音转换为文字",
  "onboarding.welcome.feature2": "⚡ 在电脑的任何地方均可使用",
  "onboarding.welcome.feature3": "🔒 您的隐私受到保护",

  "onboarding.setup.title": "设置您的转录服务",
  "onboarding.setup.desc": "配置您的云端转录提供商",
  "onboarding.setup.languageTitle": "🌍 首选语言",
  "onboarding.setup.languageLabel": "您主要使用哪种语言？",
  "onboarding.setup.languageHelp": "提高转录速度和准确性。AI 文本增强默认启用。",

  "onboarding.permissions.title": "授予权限",
  "onboarding.permissions.desc.mac": "TypeFree 需要一些权限才能正常工作",
  "onboarding.permissions.desc.win": "TypeFree 需要麦克风权限来录制您的声音",
  "onboarding.permissions.micTitle": "麦克风权限",
  "onboarding.permissions.micDesc": "录制声音所需",
  "onboarding.permissions.grant": "授予权限",
  "onboarding.permissions.accessibilityTitle": "辅助功能权限",
  "onboarding.permissions.accessibilityDesc": "自动粘贴文本所需",
  "onboarding.permissions.testGrant": "测试并授予",
  "onboarding.permissions.privacyTitle": "🔒 隐私说明",
  "onboarding.permissions.privacyDesc":
    "TypeFree 仅将这些权限用于听写。您的语音将被发送到云服务器进行转录。",

  "onboarding.hotkey.title": "设置快捷键与测试",
  "onboarding.hotkey.desc": "选择您的快捷键和激活方式",
  "onboarding.hotkey.activationMode": "激活方式",
  "onboarding.hotkey.tryIt": "立即尝试",
  "onboarding.hotkey.instruction.tap": "点击文本区域，按下 {hotkey} 开始录音，说话，再次按下停止。",
  "onboarding.hotkey.instruction.hold": "点击文本区域，按住 {hotkey} 说话，松开后处理。",
  "onboarding.hotkey.testLabel": "测试您的听写：",
  "onboarding.hotkey.testPlaceholder": "点击此处，然后使用快捷键开始听写...",

  "onboarding.agent.title": "为智能体命名",
  "onboarding.agent.desc": "给您的智能体起个名字，以便在发出指令时专门呼唤它。",
  "onboarding.agent.helpTitle": "这样做的好处：",
  "onboarding.agent.help1": "• 说“嘿 {agentName}，写一封正式邮件”来给出具体指令",
  "onboarding.agent.help2": "• 使用名字来区分听写和指令",
  "onboarding.agent.help3": "• 让交互感觉更自然和个性化",
  "onboarding.agent.inputLabel": "智能体名称",
  "onboarding.agent.inputPlaceholder": "例如：Assistant, Jarvis, Alex...",
  "onboarding.agent.footer": "您随时可以在设置中更改此项",

  "onboarding.next": "下一步",
  "onboarding.prev": "上一步",
  "onboarding.complete": "完成设置",

  "onboarding.error.hotkeyTitle": "快捷键未注册",
  "onboarding.error.hotkeyDesc": "无法注册该按键。请选择其他快捷键。",
  "onboarding.error.generic": "快捷键错误",
};

export const TRANSLATIONS: Record<UILanguage, Record<string, string>> = {
  en: EN_US,
  "zh-CN": ZH_CN,
};
