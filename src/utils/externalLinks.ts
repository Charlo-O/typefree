import { platform } from "../shared/platform";

/**
 * Opens a URL in the user's default system browser.
 */
export function openExternalLink(url: string): void {
  void platform.app.openExternal(url).then((result) => {
    if (typeof result === "object" && result !== null && result.success === false) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  });
}

/**
 * Returns an onClick handler that opens a URL in the default browser
 * Prevents default link behavior in embedded desktop webviews.
 */
export function createExternalLinkHandler(url: string) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    openExternalLink(url);
  };
}
