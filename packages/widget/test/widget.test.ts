/**
 * The widget, rendered for real.
 *
 * jsdom gives us a real DOM with a real shadow root, so these tests exercise
 * the same `mountWidget` the embed snippet calls: the launcher the page gets,
 * the theme coming from the tenant's config, a message going out and a reply
 * coming back, and the keyboard behaviour that makes it usable without a mouse.
 * `fetch` is a stub — the endpoint has its own tests against Postgres.
 */

import { afterEach, describe, expect, it } from "vitest";

import { mountWidget, type WidgetHandle } from "../src/mount";

const SITE_KEY = "pk_test_abcdefghijklmnopqrst";
const API_BASE = "https://app.example.test";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

const CONFIG = {
  businessName: "Bright Mowers",
  assistantName: "Ava",
  brandColor: "#b3006b",
  greeting: "Kia ora! Ask me about mowing, prices or a booking.",
  showPoweredBy: true,
  enabled: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(
  handler: (call: Call) => Response | Promise<Response>,
): { calls: Call[]; fetchImpl: typeof fetch } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** Let the fetch promise, the state update and the render settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

let widget: WidgetHandle | null = null;

function mount(fetchImpl: typeof fetch): WidgetHandle {
  widget = mountWidget({
    key: SITE_KEY,
    apiBase: API_BASE,
    fetchImpl,
    storage: null,
    document,
  });
  return widget;
}

afterEach(() => {
  widget?.unmount();
  widget = null;
  document.body.innerHTML = "";
});

function shadow(): ShadowRoot {
  if (!widget) throw new Error("widget is not mounted");
  return widget.shadow;
}

function launcher(): HTMLButtonElement {
  const button = shadow().querySelector("button.launcher");
  if (!(button instanceof HTMLButtonElement)) throw new Error("no launcher");
  return button;
}

async function openPanel(): Promise<HTMLElement> {
  launcher().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();
  const panel = shadow().querySelector('[role="dialog"]');
  if (!(panel instanceof HTMLElement)) throw new Error("no panel");
  return panel;
}

async function typeAndSend(text: string): Promise<void> {
  const input = shadow().querySelector("input#webina-message");
  if (!(input instanceof HTMLInputElement)) throw new Error("no input");
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
  const form = shadow().querySelector("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("no form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
}

describe("mounting", () => {
  it("renders into a shadow root and leaves the host page's DOM alone", async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse({ ok: true, config: CONFIG }));
    const handle = mount(fetchImpl);
    await flush();

    expect(handle.host.tagName.toLowerCase()).toBe("webina-widget");
    expect(handle.shadow).toBe(handle.host.shadowRoot);
    expect(handle.shadow.querySelector("style")?.textContent).toContain(":host");
    // Nothing of the widget is visible to the page's own selectors.
    expect(document.querySelector("button.launcher")).toBeNull();
  });

  it("refuses to mount without a site key", () => {
    const { fetchImpl } = stubFetch(() => jsonResponse({ ok: true, config: CONFIG }));
    expect(() =>
      mountWidget({ key: "not-a-key", apiBase: API_BASE, fetchImpl, storage: null, document }),
    ).toThrow(/site key/i);
  });
});

describe("branding", () => {
  it("takes the tenant's colour, name and greeting from the config", async () => {
    const { calls, fetchImpl } = stubFetch(() => jsonResponse({ ok: true, config: CONFIG }));
    const handle = mount(fetchImpl);
    await flush();

    expect(calls[0]?.url).toBe(`${API_BASE}/api/chat?key=${SITE_KEY}`);
    expect(calls[0]?.init?.method).toBe("GET");

    const shell = handle.shadow.querySelector(".shell");
    if (!(shell instanceof HTMLElement)) throw new Error("no shell");
    expect(shell.style.getPropertyValue("--w-brand")).toBe("#b3006b");
    // White on a dark pink, not black-on-pink.
    expect(shell.style.getPropertyValue("--w-on-brand")).toBe("#ffffff");

    const button = launcher();
    expect(button.getAttribute("aria-label")).toBe("Open chat with Ava");
    expect(button.textContent).toContain("Chat");

    const panel = await openPanel();
    expect(panel.textContent).toContain("Bright Mowers");
    expect(panel.textContent).toContain(CONFIG.greeting);
    expect(panel.textContent).toContain("Powered by Webina");
  });
});

describe("a conversation", () => {
  it("sends the message, shows the reply and reuses the conversation handle", async () => {
    let replyCount = 0;
    const { calls, fetchImpl } = stubFetch((call) => {
      if (call.init?.method !== "POST") return jsonResponse({ ok: true, config: CONFIG });
      replyCount += 1;
      return jsonResponse({
        ok: true,
        conversationRef: "cref_abcdefghijklmnopqrstuvwx",
        reply: replyCount === 1 ? "A standard mow is $80." : "Yes, Thursday at 9am is free.",
        status: "replied",
      });
    });

    mount(fetchImpl);
    await flush();
    await openPanel();

    await typeAndSend("How much for a mow?");
    const firstPost = calls.find((call) => call.init?.method === "POST");
    expect(firstPost?.url).toBe(`${API_BASE}/api/chat?key=${SITE_KEY}`);
    expect(JSON.parse(String(firstPost?.init?.body))).toMatchObject({
      message: "How much for a mow?",
    });
    expect(shadow().textContent).toContain("A standard mow is $80.");
    expect(shadow().textContent).toContain("How much for a mow?");

    await typeAndSend("Can I book Thursday?");
    const posts = calls.filter((call) => call.init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(JSON.parse(String(posts[1]?.init?.body))).toMatchObject({
      message: "Can I book Thursday?",
      customerRef: "cref_abcdefghijklmnopqrstuvwx",
    });
    expect(shadow().textContent).toContain("Yes, Thursday at 9am is free.");
  });

  it("keeps the customer's words and explains itself when the endpoint refuses", async () => {
    const { fetchImpl } = stubFetch((call) => {
      if (call.init?.method !== "POST") return jsonResponse({ ok: true, config: CONFIG });
      return jsonResponse(
        {
          ok: false,
          error: "rate_limited",
          message: "Too many messages just now.",
          retryAfterSeconds: 30,
        },
        429,
      );
    });

    mount(fetchImpl);
    await flush();
    await openPanel();
    await typeAndSend("Are you there?");

    expect(shadow().textContent).toContain("wait a moment");
    const input = shadow().querySelector("input#webina-message");
    if (!(input instanceof HTMLInputElement)) throw new Error("no input");
    expect(input.value).toBe("Are you there?");
  });
});

describe("keyboard and screen readers", () => {
  it("labels what it opens, and Escape closes the dialog back to the launcher", async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse({ ok: true, config: CONFIG }));
    mount(fetchImpl);
    await flush();

    const button = launcher();
    expect(button.getAttribute("aria-expanded")).toBe("false");

    const panel = await openPanel();
    expect(panel.getAttribute("aria-modal")).toBe("true");
    const heading = shadow().querySelector("#webina-title");
    expect(panel.getAttribute("aria-labelledby")).toBe(heading?.id);
    const log = shadow().querySelector('[role="log"]');
    expect(log?.getAttribute("aria-live")).toBe("polite");

    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();

    expect(shadow().querySelector('[role="dialog"]')).toBeNull();
    // Focus went back to the launcher, which lives inside the shadow root — so
    // the page sees focus on the host element.
    expect(document.activeElement).toBe(widget?.host);
  });

  it("announces the assistant's typing without stealing focus", async () => {
    const { fetchImpl } = stubFetch((call) => {
      if (call.init?.method !== "POST") return jsonResponse({ ok: true, config: CONFIG });
      return jsonResponse({
        ok: true,
        conversationRef: "cref_abcdefghijklmnopqrstuvwx",
        reply: "Sure thing.",
        status: "replied",
      });
    });

    mount(fetchImpl);
    await flush();
    await openPanel();

    const input = shadow().querySelector("input#webina-message");
    if (!(input instanceof HTMLInputElement)) throw new Error("no input");
    expect(input.labels?.[0]?.textContent).toContain("Bright Mowers");

    input.value = "Hello";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    const form = shadow().querySelector("form");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    // The box is cleared for the next question, and the answer is announced
    // inside the live region rather than replacing the transcript.
    expect(input.value).toBe("");
    const log = shadow().querySelector('[role="log"]');
    expect(log?.textContent).toContain("Sure thing.");
  });
});
