/**
 * Mounting the widget on somebody else's page.
 *
 * The host element carries a shadow root, so nothing inside the widget can be
 * styled by the page and nothing on the page can be styled by the widget — the
 * only thing that crosses the boundary is the host element itself. The styles
 * travel in the bundle as a string and are injected here, which is what keeps
 * the build to one file.
 */

import { h, render } from "preact";

import { App } from "./app";
import { widgetCss } from "./styles";

export const HOST_TAG = "webina-widget";

/** The script tag that loaded this bundle, captured while it is still current. */
const scriptElement: HTMLScriptElement | null =
  typeof document === "undefined" ? null : (document.currentScript as HTMLScriptElement | null);

export interface MountOptions {
  /** `pk_live_…` or `pk_test_…` — public, and useless without a registered origin. */
  key: string;
  /** Defaults to the origin the bundle was served from. */
  apiBase?: string;
  position?: "right" | "left";
  fetchImpl?: typeof fetch;
  storage?: Storage | null;
  document?: Document;
}

export interface WidgetHandle {
  host: HTMLElement;
  shadow: ShadowRoot;
  unmount(): void;
}

const mounted = new WeakMap<Document, WidgetHandle>();

/** Where the API lives: the origin the script came from, or the app itself. */
export function defaultApiBase(): string {
  if (scriptElement?.src) {
    try {
      return new URL(scriptElement.src).origin;
    } catch {
      // Fall through to the hosted default.
    }
  }
  return "https://app.webina.io";
}

function isSiteKey(value: unknown): value is string {
  return typeof value === "string" && /^pk_(live|test)_[a-z2-9]{20}$/.test(value);
}

/**
 * Mount once. A second call for the same document returns the widget already
 * on the page rather than stacking a second launcher on top of it.
 */
export function mountWidget(options: MountOptions): WidgetHandle {
  const doc = options.document ?? document;
  const existing = mounted.get(doc);
  if (existing) return existing;
  if (!isSiteKey(options.key)) {
    throw new Error("Webina widget: a site key like pk_live_… is required");
  }

  const host = doc.createElement(HOST_TAG);
  if (options.position === "left") host.setAttribute("data-position", "left");
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = widgetCss();
  const root = doc.createElement("div");
  root.setAttribute("data-webina-root", "");
  shadow.appendChild(style);
  shadow.appendChild(root);
  doc.body.appendChild(host);

  render(
    h(App, {
      siteKey: options.key,
      apiBase: options.apiBase ?? defaultApiBase(),
      fetchImpl: options.fetchImpl,
      storage: options.storage === undefined ? defaultStorage() : options.storage,
    }),
    root,
  );

  const handle: WidgetHandle = {
    host,
    shadow,
    unmount() {
      render(null, root);
      host.remove();
      mounted.delete(doc);
    },
  };
  mounted.set(doc, handle);
  return handle;
}

function defaultStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Auto-mount from the embed snippet:
 *
 *   <script src="https://app.webina.io/webina-widget.js"
 *           data-webina-key="pk_live_…" async></script>
 *
 * No key, no widget — a misconfigured tag fails silently rather than throwing
 * on a customer's page.
 */
export function autoMount(): void {
  const key = scriptElement?.dataset.webinaKey?.trim();
  if (!key || !isSiteKey(key)) return;
  const position = scriptElement?.dataset.webinaPosition === "left" ? "left" : "right";
  mountWidget({
    key,
    position,
    ...(scriptElement?.dataset.webinaApi ? { apiBase: scriptElement.dataset.webinaApi } : {}),
  });
}
