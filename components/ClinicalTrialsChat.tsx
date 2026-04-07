"use client";

import type { PersistedChatTurn } from "@/lib/conversationLocalHistory";
import { useCallback } from "react";
import type { KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type ClinicalTrialsChatProps = {
  active: boolean;
  heroInput: string;
  setHeroInput: (value: string) => void;
  chatInput: string;
  setChatInput: (value: string) => void;
  turns: PersistedChatTurn[];
  agentDebug: boolean;
  setAgentDebug: (value: boolean) => void;
  drawerOpen: boolean;
  setDrawerOpen: (value: boolean) => void;
  loadingPhase: "idle" | "agent" | "trials";
  onSubmit: (text: string, fromHero: boolean) => void | Promise<void>;
};

export function ClinicalTrialsChat({
  active,
  heroInput,
  setHeroInput,
  chatInput,
  setChatInput,
  turns,
  agentDebug,
  setAgentDebug,
  drawerOpen,
  setDrawerOpen,
  loadingPhase,
  onSubmit,
}: ClinicalTrialsChatProps) {
  const submitHero = useCallback(() => {
    void onSubmit(heroInput, true);
  }, [heroInput, onSubmit]);

  const submitChat = useCallback(() => {
    void onSubmit(chatInput, false);
  }, [chatInput, onSubmit]);

  const onHeroKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitHero();
    }
  };

  const onChatKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitChat();
    }
  };

  if (!active) {
    return (
      <div className="hero-center">
        <h1 className="hero-title">Clinical Trials Intelligence</h1>
        <div className="input-shell pad-input">
          <textarea
            className="input-field pad-input-sm"
            rows={1}
            placeholder="Describe what you're looking for — condition, intent, equipment type..."
            value={heroInput}
            onChange={(e) => setHeroInput(e.target.value)}
            onKeyDown={onHeroKeyDown}
          />
          <button
            type="button"
            className="btn-icon pad-input-sm"
            aria-label="Send"
            disabled={!heroInput.trim()}
            onClick={submitHero}
          >
            <SendIcon />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {drawerOpen && (
        <button
          type="button"
          className="chat-backdrop"
          aria-label="Close chat"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <aside
        className={`column-chat ${drawerOpen ? "is-open fixed z-50 h-full surface-elevated" : ""}`}
      >
        <div className="flex flex-1 flex-col overflow-hidden">
          {drawerOpen && (
            <div className="border-default pad-section flex justify-end mobile-only">
              <button type="button" className="btn-icon" onClick={() => setDrawerOpen(false)}>
                ✕
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto pad-section flex flex-col">
            <div className="flex items-center justify-end gap-stack margin-block-md">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={agentDebug}
                  onChange={(e) => setAgentDebug(e.target.checked)}
                />
                Agent debug
              </label>
            </div>
            <div className="chat-turns flex flex-col">
              {turns.map((turn) => (
                <div key={turn.id} className="chat-turn flex flex-col gap-stack">
                  <div className="bubble-user">
                    {turn.prompt}
                    <div className="bubble-meta">{new Date(turn.ts).toLocaleString()}</div>
                  </div>
                  {turn.streamText !== undefined && (
                    <div className="assistant-md border-default surface-elevated pad-section">
                      {agentDebug && (
                        <p className="text-muted margin-block-sm text-xs font-medium">
                          Agent response (plain text stream)
                        </p>
                      )}
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.streamText}</ReactMarkdown>
                      {turn.streamError && (
                        <p className="text-muted margin-block-sm">Stream ended with an error.</p>
                      )}
                    </div>
                  )}
                  {turn.submittedStrategy && (
                    <>
                      {agentDebug ? (
                        <details className="border-default surface-elevated pad-section text-xs">
                          <summary className="cursor-pointer font-medium text-accent">
                            Assistant thought
                          </summary>
                          <p className="text-muted margin-block-sm">
                            {turn.submittedStrategy.rationale}
                          </p>
                        </details>
                      ) : (
                        <div className="border-default surface-elevated pad-section text-xs flex flex-col gap-stack">
                          <p className="font-medium text-accent">Assistant thought</p>
                          <p className="text-muted">{turn.submittedStrategy.rationale}</p>
                        </div>
                      )}
                      {agentDebug && (
                        <details className="border-default surface-elevated pad-section text-xs">
                          <summary className="cursor-pointer font-medium text-accent">
                            Agent response: search strategy (JSON)
                          </summary>
                          <pre className="detail-pre margin-block-sm overflow-x-auto text-[11px]">
                            {JSON.stringify(turn.submittedStrategy, null, 2)}
                          </pre>
                        </details>
                      )}
                    </>
                  )}
                  {agentDebug && turn.agentMalformedRaw !== undefined && (
                    <details className="border-default surface-elevated pad-section text-xs">
                      <summary className="cursor-pointer font-medium text-accent">
                        Agent output (unparseable)
                      </summary>
                      <pre className="detail-pre margin-block-sm overflow-x-auto whitespace-pre-wrap text-[11px]">
                        {turn.agentMalformedRaw || "(empty)"}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="border-default pad-section">
            <div className="input-shell pad-input">
              <textarea
                className="input-field pad-input-sm"
                rows={2}
                placeholder="Follow up…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={onChatKeyDown}
              />
              <button
                type="button"
                className="btn-icon pad-input-sm"
                aria-label="Send"
                disabled={!chatInput.trim() || loadingPhase !== "idle"}
                onClick={submitChat}
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <button
        type="button"
        className="fab-chat"
        aria-label="Open conversation"
        onClick={() => setDrawerOpen(true)}
      >
        <ChatIcon />
      </button>
    </>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
