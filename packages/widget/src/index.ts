/**
 * `@webina/widget` — the bundle a business puts on its site.
 *
 * The file is self-contained: Preact, the styles and the UI. Loaded from a
 * script tag with `data-webina-key`, it mounts itself; imported by the
 * dashboard, `mountWidget` does the same thing explicitly.
 */

export { mountWidget, autoMount, defaultApiBase, HOST_TAG } from "./mount";
export type { MountOptions, WidgetHandle } from "./mount";
export { App } from "./app";
export type { AppProps } from "./app";
export { widgetCss } from "./styles";
export { ChatApiError, chatEndpoint, loadWidgetConfig, sendChatMessage } from "./api";

import { autoMount, mountWidget } from "./mount";

declare global {
  interface Window {
    Webina?: {
      mount: typeof mountWidget;
      version: string;
    };
  }
}

export const VERSION = "0.1.0";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.Webina = { mount: mountWidget, version: VERSION };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  } else {
    autoMount();
  }
}
