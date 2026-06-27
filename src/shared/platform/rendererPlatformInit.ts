import { legacyDesktopAPI, type LegacyDesktopAPI } from "./legacyDesktopApi";
import { initializePlatformBootstrap } from "./platformBootstrap";

export function initializeRendererPlatform(): LegacyDesktopAPI {
  initializePlatformBootstrap(legacyDesktopAPI);
  return legacyDesktopAPI;
}

initializeRendererPlatform();

export default initializeRendererPlatform;
