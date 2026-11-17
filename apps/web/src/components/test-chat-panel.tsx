/**
 * The test chat sandbox.
 *
 * It runs the real agent loop against the tenant's real services, prices and
 * hours — the only thing missing is a customer. Anything the assistant books
 * here is a real booking, so the owner can see the whole path before going
 * live; the conversation is a normal web conversation and can be handed over
 * like any other.
 */

import { useState, type FormEvent } from "react";

import { sendTestChat } from "~/server/dashboard";
import { Pill, type AnyResult } from "~/components/ui";

interface Turn {
  role: "user" | "assistant";
  text: string;
  tools?: string[];
}

export function TestChatPanel({
  businessId,
  onSent,
}: {
  businessId: string;
  onSent?: () => void | Promise<void>;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [result, setResult] = useState<AnyResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (text === "" || busy) return;
    setBusy(true);
    setResult(null);
    setTurns((current) => [...current, { role: "user", text }]);
    setMessage("");
    try {
      const response = await sendTestChat({
        data: { businessId, message: text, conversationId },
      });
      setResult(response);
      if (response.status === "ok") {
        setConversationId(response.data.conversationId);
        setTurns((current) => [
          ...current,
          { role: "assistant", text: response.data.reply, tools: response.data.tools },
        ]);
        await onSent?.();
      }
    } catch (error) {
      setResult({ status: "error", message: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="muted">
        Type what a customer would type. The assistant answers with your services, your prices and
        your hours — and books into your real calendar, so cancel anything you do not want.
      </p>

      {result && result.status !== "ok" ? (
        <div className="notice error">
          {result.status === "signed_out"
            ? "Your session expired. Sign in again."
            : (result.message ?? "Something went wrong. Try again.")}
        </div>
      ) : null}

      <div className="chat">
        {turns.length === 0 ? (
          <p className="muted">No messages yet. Try “How much for a medium lawn mow?”</p>
        ) : (
          turns.map((turn, index) => (
            <div className={`bubble ${turn.role}`} key={`${turn.role}-${index}`}>
              {turn.text}
              {turn.tools && turn.tools.length > 0 ? (
                <div className="tools">
                  {turn.tools.map((tool) => (
                    <Pill key={tool}>{tool}</Pill>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <form className="toolbar" style={{ marginTop: "0.8rem" }} onSubmit={onSubmit}>
        <label style={{ flex: 1 }}>
          Your message
          <input
            type="text"
            maxLength={1000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Hi, how much to mow a medium lawn on Friday?"
          />
        </label>
        <button type="submit" disabled={busy || message.trim() === ""}>
          {busy ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setTurns([]);
            setConversationId(null);
          }}
        >
          Start again
        </button>
      </form>
    </div>
  );
}
