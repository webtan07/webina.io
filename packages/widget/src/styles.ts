/**
 * The widget's stylesheet, as a string.
 *
 * It is injected into the shadow root, so it cannot leak out onto the customer's
 * page and the page's own CSS cannot leak in. Everything themable is a custom
 * property set from the tenant's settings; everything else is fixed, because a
 * chat window is not the place to discover that a site has a global `button`
 * rule.
 *
 * Mobile first: under 480px the panel takes the whole screen (with the notch
 * and the home bar respected), and the input is 16px because anything smaller
 * makes iOS zoom the page on focus.
 */

export function widgetCss(): string {
  return `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483000;
  right: 20px;
  bottom: 20px;
  display: block;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.45;
  text-align: left;
  color: #1b2a41;
  --w-brand: #0f7b8a;
  --w-on-brand: #ffffff;
  --w-ink: #1b2a41;
  --w-muted: #5b6b7c;
  --w-paper: #ffffff;
  --w-rule: #d7e0e4;
  --w-radius: 16px;
  --w-shadow: 0 12px 40px rgba(15, 26, 40, 0.22);
  --w-safe-bottom: env(safe-area-inset-bottom, 0px);
}

*, *::before, *::after { box-sizing: border-box; }
button, input { font: inherit; color: inherit; }

.launcher {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  background: var(--w-brand);
  color: var(--w-on-brand);
  box-shadow: var(--w-shadow);
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  transition: transform 120ms ease;
}
.launcher:hover { transform: translateY(-1px); }
.launcher:active { transform: translateY(0); }
.launcher:focus-visible { outline: 3px solid var(--w-on-brand); outline-offset: -4px; }
.launcher svg { width: 20px; height: 20px; display: block; }

.panel {
  position: absolute;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: 380px;
  max-width: calc(100vw - 40px);
  height: 560px;
  max-height: calc(100vh - 40px);
  background: var(--w-paper);
  border: 1px solid var(--w-rule);
  border-radius: var(--w-radius);
  box-shadow: var(--w-shadow);
  overflow: hidden;
  animation: webina-rise 160ms ease-out;
}
@keyframes webina-rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

.header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 12px 14px 16px;
  background: var(--w-brand);
  color: var(--w-on-brand);
}
.header h2 { margin: 0; font-size: 15px; font-weight: 700; }
.header p { margin: 2px 0 0; font-size: 12px; opacity: 0.9; }
.close {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.close:hover { background: rgba(255, 255, 255, 0.16); }
.close:focus-visible { outline: 3px solid var(--w-on-brand); outline-offset: -4px; }
.close svg { width: 18px; height: 18px; display: block; }

.log {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: #f7f9fb;
}

.bubble {
  max-width: 85%;
  padding: 10px 12px;
  border-radius: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.bubble.assistant {
  align-self: flex-start;
  background: var(--w-paper);
  border: 1px solid var(--w-rule);
  border-bottom-left-radius: 4px;
}
.bubble.user {
  align-self: flex-end;
  background: var(--w-brand);
  color: var(--w-on-brand);
  border-bottom-right-radius: 4px;
}
.bubble.notice {
  align-self: stretch;
  max-width: 100%;
  background: #fff4e5;
  border: 1px solid #f0d9b5;
  color: #6b4a12;
  font-size: 13px;
  text-align: center;
}

.typing { align-self: flex-start; color: var(--w-muted); font-size: 13px; }

.composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 12px;
  padding-bottom: calc(12px + var(--w-safe-bottom));
  border-top: 1px solid var(--w-rule);
  background: var(--w-paper);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.composer input {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 44px;
  padding: 10px 12px;
  font-size: 16px;
  color: var(--w-ink);
  background: var(--w-paper);
  border: 1px solid var(--w-rule);
  border-radius: 12px;
}
.composer input:focus-visible {
  outline: 3px solid var(--w-brand);
  outline-offset: 1px;
  border-color: var(--w-brand);
}
.composer input[disabled] { background: #f2f5f7; color: var(--w-muted); }

.send {
  display: grid;
  place-items: center;
  min-width: 44px;
  min-height: 44px;
  border: 0;
  border-radius: 12px;
  background: var(--w-brand);
  color: var(--w-on-brand);
  cursor: pointer;
}
.send[disabled] { opacity: 0.55; cursor: not-allowed; }
.send:focus-visible { outline: 3px solid var(--w-ink); outline-offset: 2px; }
.send svg { width: 18px; height: 18px; display: block; }

.footer {
  margin: 0;
  padding: 0 12px 10px;
  padding-bottom: calc(10px + var(--w-safe-bottom));
  font-size: 11px;
  color: var(--w-muted);
  text-align: center;
  background: var(--w-paper);
}

@media (max-width: 480px) {
  :host { right: 0; bottom: 0; left: 0; }
  .launcher {
    position: fixed;
    right: 16px;
    bottom: calc(16px + var(--w-safe-bottom));
  }
  .panel {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    border: 0;
    border-radius: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .panel { animation: none; }
  .launcher { transition: none; }
}
`;
}
