/**
 * The widget UI.
 *
 * One launcher, one panel, one input. The rules it keeps:
 *
 * - **The tenant's colours and name, and nothing of ours.** The brand colour
 *   arrives from the config call and is applied as a custom property; the text
 *   colour on top of it is computed for contrast rather than assumed.
 * - **It works from the keyboard alone.** The launcher says what it opens, the
 *   panel is a dialog that takes focus, Escape closes it and hands focus back,
 *   Tab cycles inside it, and every reply is announced through a live region.
 * - **It never loses the customer's words.** A failed send leaves the message
 *   they typed in the box and says what happened; it does not clear the field.
 */

import { brandInk, safeBrandColor } from "@webina/shared/brand";
import type { WidgetConfig } from "@webina/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { ChatApiError, loadWidgetConfig, sendChatMessage } from "./api";

export interface AppProps {
  siteKey: string;
  apiBase: string;
  fetchImpl?: typeof fetch;
  /** sessionStorage by default; tests pass their own, or null. */
  storage?: Storage | null;
}

type BubbleRole = "user" | "assistant" | "notice";

interface Bubble {
  id: string;
  role: BubbleRole;
  text: string;
}

const FALLBACK_MESSAGE = "Sorry, something went wrong. Please try again.";
const OFFLINE_MESSAGE = "The team is away from chat right now. Please try again shortly.";

function storageKey(siteKey: string): string {
  return `webina:chat:${siteKey}`;
}

function readConversationRef(storage: Storage | null, siteKey: string): string | null {
  try {
    return storage?.getItem(storageKey(siteKey)) ?? null;
  } catch {
    return null;
  }
}

function writeConversationRef(storage: Storage | null, siteKey: string, ref: string): void {
  try {
    storage?.setItem(storageKey(siteKey), ref);
  } catch {
    // Private mode, or storage full. The conversation still continues in memory.
  }
}

function messageFor(error: unknown): string {
  if (error instanceof ChatApiError) {
    if (error.code === "rate_limited" || error.status === 429) {
      return "You're sending messages quickly — please wait a moment and try again.";
    }
    if (error.code === "origin_not_allowed" || error.code === "unknown_site_key") {
      return "This chat is not available on this website.";
    }
  }
  return FALLBACK_MESSAGE;
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6a11 11 0 0 1-2.6-.3l-4 1.6a.6.6 0 0 1-.8-.7l.7-3A7.3 7.3 0 0 1 3 10.6C3 6.4 7 3 12 3Z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M3.4 20.4 21 12 3.4 3.6l.1 6.6L15 12 3.5 13.8Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function App(props: AppProps) {
  const storage = props.storage === undefined ? defaultStorage() : props.storage;

  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const conversationRef = useRef<string | null>(readConversationRef(storage, props.siteKey));
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(false);
  const counter = useRef(0);

  const nextId = (): string => {
    counter.current += 1;
    return `w${counter.current}`;
  };

  // Branding before the first click, so the launcher is already the tenant's.
  useEffect(() => {
    let cancelled = false;
    loadWidgetConfig({ apiBase: props.apiBase, siteKey: props.siteKey, fetchImpl: props.fetchImpl })
      .then((loaded) => {
        if (!cancelled) setConfig(loaded);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.apiBase, props.siteKey, props.fetchImpl]);

  // The tenant's colours, as custom properties on the shell.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const brand = safeBrandColor(config?.brandColor);
    shell.style.setProperty("--w-brand", brand);
    shell.style.setProperty("--w-on-brand", brandInk(brand));
  }, [config]);

  // Opening the panel puts the cursor in the box; closing it hands focus back.
  // A layout effect, not a passive one: closing removes the focused input, and
  // the browser drops focus to <body> the moment that happens. Restoring it has
  // to be part of the same commit, or a keyboard user is left with nothing
  // focused and has to Tab in from the top of the page.
  useLayoutEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else if (wasOpen.current) {
      launcherRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // Keep the newest message in view.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [bubbles, sending]);

  const close = (): void => setOpen(false);

  const handlePanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || panelRef.current === null) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const target = event.target as HTMLElement | null;
    if (event.shiftKey && target === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && target === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSubmit = (event: Event): void => {
    event.preventDefault();
    const text = input.trim();
    if (text === "" || sending || unavailable) return;
    if (config !== null && !config.enabled) {
      setBubbles((previous) => [...previous, { id: nextId(), role: "notice", text: OFFLINE_MESSAGE }]);
      return;
    }
    setBubbles((previous) => [...previous, { id: nextId(), role: "user", text }]);
    setInput("");
    setSending(true);
    sendChatMessage({
      apiBase: props.apiBase,
      siteKey: props.siteKey,
      fetchImpl: props.fetchImpl,
      message: text,
      customerRef: conversationRef.current,
    })
      .then((reply) => {
        conversationRef.current = reply.conversationRef;
        writeConversationRef(storage, props.siteKey, reply.conversationRef);
        setBubbles((previous) => [
          ...previous,
          { id: nextId(), role: "assistant", text: reply.reply },
        ]);
      })
      .catch((error: unknown) => {
        // Give the customer their words back rather than making them retype.
        setInput((current) => (current === "" ? text : current));
        setBubbles((previous) => [
          ...previous,
          { id: nextId(), role: "notice", text: messageFor(error) },
        ]);
      })
      .finally(() => {
        setSending(false);
      });
  };

  const assistantName = config?.assistantName ?? "the assistant";
  const businessName = config?.businessName ?? "this business";
  const sendDisabled = sending || input.trim() === "" || unavailable;

  return (
    <div class="shell" ref={shellRef}>
      {open ? (
        <div
          class="panel"
          id="webina-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="webina-title"
          ref={panelRef}
          onKeyDown={handlePanelKeyDown}
        >
          <div class="header">
            <div>
              <h2 id="webina-title">{businessName}</h2>
              <p>Chat with {assistantName}</p>
            </div>
            <button type="button" class="close" aria-label="Close chat" onClick={close}>
              <CloseIcon />
            </button>
          </div>
          <div class="log" role="log" aria-live="polite" aria-relevant="additions text" ref={logRef}>
            {config !== null && bubbles.length === 0 ? (
              <p class="bubble assistant">{config.greeting}</p>
            ) : null}
            {bubbles.map((bubble) => (
              <p key={bubble.id} class={`bubble ${bubble.role}`}>
                {bubble.text}
              </p>
            ))}
            {loadingConfig ? (
              <p class="typing" role="status">
                Loading…
              </p>
            ) : null}
            {sending ? (
              <p class="typing" role="status">
                {assistantName} is typing…
              </p>
            ) : null}
          </div>
          <form class="composer" onSubmit={handleSubmit}>
            <label class="sr-only" for="webina-message">
              Your message to {businessName}
            </label>
            <input
              id="webina-message"
              ref={inputRef}
              type="text"
              autoComplete="off"
              placeholder={`Message ${businessName}`}
              value={input}
              disabled={unavailable}
              onInput={(event) => setInput((event.target as HTMLInputElement).value)}
            />
            <button type="submit" class="send" aria-label="Send message" disabled={sendDisabled}>
              <SendIcon />
            </button>
          </form>
          {config?.showPoweredBy ? <p class="footer">Powered by Webina</p> : null}
        </div>
      ) : (
        <button
          type="button"
          class="launcher"
          ref={launcherRef}
          aria-label={`Open chat with ${assistantName}`}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <ChatIcon />
          <span>Chat</span>
        </button>
      )}
    </div>
  );
}

function defaultStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
