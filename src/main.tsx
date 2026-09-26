import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

// Initialize renderer platform aliases before any UI code mounts.
import "./shared/platform/rendererPlatformInit";
import { AppRouter } from "./AppRouter";
import { ToastProvider } from "./components/ui/Toast";
import { migrateLegacyCredentialMirrorsToCredentialStore } from "./features/settings/credentialMigration";
import { I18nProvider } from "./i18n";
import "./index.css";

async function mountApp() {
  await migrateLegacyCredentialMirrorsToCredentialStore();

  const rootElement = document.getElementById("root");

  if (!rootElement) {
    throw new Error("Root element #root not found");
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <Theme theme={neutralTheme}>
        <I18nProvider>
          <ToastProvider>
            <Suspense fallback={null}>
              <AppRouter />
            </Suspense>
          </ToastProvider>
        </I18nProvider>
      </Theme>
    </React.StrictMode>
  );
}

void mountApp();
