import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";

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
      <I18nProvider>
        <ToastProvider>
          <Suspense fallback={null}>
            <AppRouter />
          </Suspense>
        </ToastProvider>
      </I18nProvider>
    </React.StrictMode>
  );
}

void mountApp();
