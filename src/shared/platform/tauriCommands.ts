/**
 * Legacy Tauri command compatibility barrel.
 *
 * New UI code should import `platform` from `src/shared/platform`. This module
 * keeps older wrappers, debug helpers, and `src/utils/tauriAPI.ts` compatible.
 */

import { legacyDesktopAPI } from "./legacyDesktopApi";

export * from "./platformCommands";
export { legacyDesktopAPI };

export const tauriAPI = legacyDesktopAPI;
export default tauriAPI;
