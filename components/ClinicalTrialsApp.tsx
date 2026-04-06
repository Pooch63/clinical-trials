"use client";

import type { ConversationMessage, SearchStrategy, Trial, TrialsResponse } from "@/types";
import { Fragment, useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type SortKey = "score" | "startDate" | "enrollment";
type SortDir = "asc" | "desc";

function formatTrialDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString("en", { month: "short", year: "numeric" });
  }
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
  }
  return s;
}

function statusBadgeClass(status: string): string {
  if (status === "RECRUITING") return "badge badge-recruiting";
  if (status === "NOT_YET_RECRUITING") return "badge badge-notyet";
  return "badge badge-neutral";
}

function scoreClass(tier: string): string {
  if (tier === "high") return "score-high";
  if (tier === "medium") return "score-mid";
  return "score-low";
}

export function ClinicalTrialsApp() {
  const [active, setActive] = useState(false);
  const [heroInput, setHeroInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [turns, setTurns] = useState<
    Array<{
      id: string;
      prompt: string;
      ts: number;
      streamText?: string;
      streamError?: boolean;
      /** Present when the agent returned a parsed search strategy (trials fetch path). */
      submittedStrategy?: SearchStrategy;
      /** Present when the agent returned JSON that could not be parsed as a strategy (422). */
      agentMalformedRaw?: string;
    }>
  >([]);
  const [agentDebug, setAgentDebug] = useState(
    () => process.env.NEXT_PUBLIC_AGENT_DEBUG === "1",
  );
  const [loadingPhase, setLoadingPhase] = useState<"idle" | "agent" | "trials">("idle");
  const [trialsRes, setTrialsRes] = useState<TrialsResponse | null>(null);
  const [lastStrategy, setLastStrategy] = useState<SearchStrategy | null>(null);
  const [trialsError, setTrialsError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sortedTrials = useMemo(() => {
    const list = trialsRes?.trials ? [...trialsRes.trials] : [];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "score") cmp = a.score - b.score;
      else if (sortKey === "enrollment") {
        const ae = a.enrollmentCount ?? -1;
        const be = b.enrollmentCount ?? -1;
        cmp = ae - be;
      } else {
        const ad = a.startDate ?? "";
        const bd = b.startDate ?? "";
        cmp = ad.localeCompare(bd);
      }
      return cmp * dir;
    });
    return list;
  }, [trialsRes, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "score" ? "desc" : "desc");
    }
  };

  const runAgentAndMaybeTrials = useCallback(
    async (messages: ConversationMessage[], turnId: string) => {
      setLoadingPhase("agent");
      setTrialsError(null);
      setTrialsRes(null);
      setLastStrategy(null);

      let res: Response;
      try {
        res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        });
      } catch {
        console.log("[ClinicalTrialsApp] agent output (fetch failed)");
        setTurns((t) =>
          t.map((x) =>
            x.id === turnId ? { ...x, streamText: "Network error.", streamError: true } : x,
          ),
        );
        setLoadingPhase("idle");
        return;
      }

      const ct = res.headers.get("content-type") ?? "";

      if (ct.includes("application/json")) {
        const data = (await res.json()) as SearchStrategy & {
          error?: string;
          message?: string;
          rawOutput?: string;
        };
        if (!res.ok) {
          const raw = typeof data.rawOutput === "string" ? data.rawOutput : undefined;
          console.log("[ClinicalTrialsApp] agent output (error)", {
            status: res.status,
            error: data.error,
            message: data.message,
            rawOutput: raw,
          });
          if (raw) {
            setTurns((t) =>
              t.map((x) => (x.id === turnId ? { ...x, agentMalformedRaw: raw } : x)),
            );
          }
          setTrialsError(data.message ?? data.error ?? "Agent error");
          setLoadingPhase("idle");
          return;
        }
        const strategy = data as SearchStrategy;
        console.log("[ClinicalTrialsApp] agent output (search strategy)", strategy);
        setTurns((t) =>
          t.map((x) => (x.id === turnId ? { ...x, submittedStrategy: strategy } : x)),
        );
        setLoadingPhase("trials");
        let trialsResponse: Response;
        try {
          trialsResponse = await fetch("/api/trials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ strategy }),
          });
        } catch {
          setTrialsError("Could not reach trials service.");
          setLoadingPhase("idle");
          return;
        }
        const tr = (await trialsResponse.json()) as TrialsResponse & { error?: string; message?: string };
        if (!trialsResponse.ok) {
          setTrialsError(tr.message ?? "ClinicalTrials.gov request failed");
          setLoadingPhase("idle");
          return;
        }
        setTrialsRes(tr);
        setLastStrategy(strategy);
        setLoadingPhase("idle");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        console.log("[ClinicalTrialsApp] agent output (empty body)");
        setTurns((t) =>
          t.map((x) =>
            x.id === turnId ? { ...x, streamText: "Empty response.", streamError: true } : x,
          ),
        );
        setLoadingPhase("idle");
        return;
      }

      const decoder = new TextDecoder();
      let full = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setTurns((t) => t.map((x) => (x.id === turnId ? { ...x, streamText: full } : x)));
        }
      } catch {
        console.log("[ClinicalTrialsApp] agent output (stream interrupted)", full);
        setTurns((t) =>
          t.map((x) =>
            x.id === turnId
              ? { ...x, streamText: full + "\n\n*(stream interrupted)*", streamError: true }
              : x,
          ),
        );
        setLoadingPhase("idle");
        return;
      }

      console.log("[ClinicalTrialsApp] agent output (text stream)", full);
      setConversation((prev) => [...prev, { role: "assistant", content: full }]);
      setLoadingPhase("idle");
    },
    [],
  );

  const submit = async (text: string, fromHero: boolean) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const id = crypto.randomUUID();
    const ts = Date.now();

    if (!active) {
      setActive(true);
    }

    setTurns((t) => [...t, { id, prompt: trimmed, ts }]);
    const nextConv: ConversationMessage[] = [...conversation, { role: "user", content: trimmed }];
    setConversation(nextConv);

    if (fromHero) setHeroInput("");
    else setChatInput("");

    await runAgentAndMaybeTrials(nextConv, id);
  };

  const onHeroKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit(heroInput, true);
    }
  };

  const onChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit(chatInput, false);
    }
  };

  return (
    <div className="surface-page min-h-screen">
      {!active && (
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
              onClick={() => void submit(heroInput, true)}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      )}

      {active && (
        <div className="layout-split">
          {drawerOpen && (
            <button
              type="button"
              className="chat-backdrop"
              aria-label="Close chat"
              onClick={() => setDrawerOpen(false)}
            />
          )}
          <aside className={`column-chat ${drawerOpen ? "is-open fixed z-50 h-full surface-elevated" : ""}`}>
            <div className="flex flex-1 flex-col overflow-hidden">
              {drawerOpen && (
                <div className="border-default pad-section flex justify-end mobile-only">
                  <button type="button" className="btn-icon" onClick={() => setDrawerOpen(false)}>
                    ✕
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto pad-section gap-stack flex flex-col">
                <div className="flex items-center justify-end gap-stack">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={agentDebug}
                      onChange={(e) => setAgentDebug(e.target.checked)}
                    />
                    Agent debug
                  </label>
                </div>
                {turns.map((turn) => (
                  <div key={turn.id} className="margin-block-md">
                    <div className="bubble-user">
                      {turn.prompt}
                      <div className="bubble-meta">{new Date(turn.ts).toLocaleString()}</div>
                    </div>
                    {turn.streamText !== undefined && (
                      <div className="assistant-md margin-block-md border-default surface-elevated pad-section">
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
                    {agentDebug && turn.submittedStrategy && (
                      <details className="margin-block-md border-default surface-elevated pad-section text-xs">
                        <summary className="cursor-pointer font-medium text-accent">
                          Agent response: search strategy (JSON)
                        </summary>
                        <p className="text-muted margin-block-sm">
                          <strong>Rationale:</strong> {turn.submittedStrategy.rationale}
                        </p>
                        <pre className="detail-pre margin-block-sm overflow-x-auto text-[11px]">
                          {JSON.stringify(turn.submittedStrategy, null, 2)}
                        </pre>
                      </details>
                    )}
                    {agentDebug && turn.agentMalformedRaw !== undefined && (
                      <details className="margin-block-md border-default surface-elevated pad-section text-xs">
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
                    onClick={() => void submit(chatInput, false)}
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

          <main className="column-main">
            {loadingPhase !== "idle" && (
              <div className="state-center">
                <div className="spinner" />
                <p className="text-muted">
                  {loadingPhase === "agent"
                    ? "Agent is building your query…"
                    : "Searching clinical trials…"}
                </p>
              </div>
            )}

            {loadingPhase === "idle" && trialsError && (
              <div className="state-center">
                <p className="text-muted">{trialsError}</p>
                <button
                  type="button"
                  className="border-default pad-input text-accent"
                  onClick={() => setTrialsError(null)}
                >
                  Dismiss
                </button>
              </div>
            )}

            {loadingPhase === "idle" && !trialsError && trialsRes && trialsRes.trials.length > 0 && (
              <div className="flex flex-1 flex-col overflow-hidden pad-page">
                <div className="margin-block-md flex flex-wrap items-baseline justify-between gap-stack">
                  <p className="text-muted">
                    {trialsRes.totalFetched} trials found
                    {trialsRes.capped ? " (results capped at 5,000)" : ""} · sorted by relevance
                  </p>
                </div>
                {lastStrategy && <ScoringLegend strategy={lastStrategy} />}
                <div className="desktop-only flex-1 overflow-hidden">
                  <TrialTableDesktop
                    trials={sortedTrials}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    expanded={expanded}
                    onToggleRow={(id) => setExpanded((e) => (e === id ? null : id))}
                  />
                </div>
                <div className="mobile-only flex-1 overflow-y-auto">
                  <TrialCards trials={sortedTrials} />
                </div>
              </div>
            )}

            {loadingPhase === "idle" &&
              !trialsError &&
              trialsRes?.zeroResults &&
              lastStrategy && (
                <div className="state-center">
                  <p className="text-muted text-center max-w-md">
                    No trials matched after filtering. Try broadening your condition terms or
                    relaxing phase and status filters in a follow-up message.
                  </p>
                </div>
              )}

            {loadingPhase === "idle" && !trialsRes && !trialsError && (
              <div className="state-center">
                <p className="text-muted text-center max-w-sm">
                  {turns.some((t) => t.streamText)
                    ? "When the agent has enough context, trial results will appear here."
                    : "Waiting for the agent to return a search strategy."}
                </p>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function ScoringLegend({ strategy }: { strategy: SearchStrategy }) {
  const h = strategy.priority_scoring_hints;
  const parts: string[] = [];
  if (h.boost_if_condition_contains.length)
    parts.push(`Conditions: ${h.boost_if_condition_contains.join(", ")}`);
  if (h.boost_if_keyword_contains.length)
    parts.push(`Keywords: ${h.boost_if_keyword_contains.join(", ")}`);
  if (h.boost_if_eligibility_contains.length)
    parts.push(`Eligibility: ${h.boost_if_eligibility_contains.join(", ")}`);
  if (h.boost_intervention_types.length)
    parts.push(`Intervention types: ${h.boost_intervention_types.join(", ")}`);
  if (h.boost_phases.length) parts.push(`Phases: ${h.boost_phases.join(", ")}`);
  if (h.boost_sponsor_class.length) parts.push(`Sponsors: ${h.boost_sponsor_class.join(", ")}`);
  if (h.boost_if_enrollment_above != null)
    parts.push(`Enrollment > ${h.boost_if_enrollment_above}`);
  if (!parts.length) return null;
  return (
    <div className="legend-bar margin-block-md">
      <strong className="text-accent">Scoring signals:</strong> {parts.join(" · ")}
    </div>
  );
}

function TrialTableDesktop({
  trials,
  sortKey,
  sortDir,
  onSort,
  expanded,
  onToggleRow,
}: {
  trials: Trial[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  expanded: string | null;
  onToggleRow: (id: string) => void;
}) {
  return (
    <div className="table-wrap flex-1">
      <table className="table-grid">
        <thead>
          <tr>
            <th className="th-sort" onClick={() => onSort("score")}>
              Score{sortKey === "score" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
            </th>
            <th>NCT ID</th>
            <th>Title</th>
            <th>Condition(s)</th>
            <th>Status</th>
            <th>Phase</th>
            <th className="th-sort" onClick={() => onSort("startDate")}>
              Start{sortKey === "startDate" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
            </th>
            <th className="th-sort cell-num" onClick={() => onSort("enrollment")}>
              N{sortKey === "enrollment" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
            </th>
            <th>Sponsor</th>
            <th>Contact</th>
          </tr>
        </thead>
        <tbody>
          {trials.map((trial) => (
            <Fragment key={trial.nctId}>
              <tr onClick={() => onToggleRow(trial.nctId)}>
                <td className={`cell-num ${scoreClass(trial.scoreTier)}`}>{trial.score}</td>
                <td>
                  <a
                    className="link-accent font-mono text-xs"
                    href={`https://clinicaltrials.gov/study/${trial.nctId}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {trial.nctId}
                  </a>
                </td>
                <td className="max-w-title">
                  <span className="line-clamp-2" title={trial.briefTitle}>
                    {trial.briefTitle}
                  </span>
                </td>
                <td className="max-w-cond">
                  {trial.conditions.slice(0, 6).map((c) => (
                    <span key={c} className="pill">
                      {c}
                    </span>
                  ))}
                </td>
                <td>
                  <span className={statusBadgeClass(trial.overallStatus)}>{trial.overallStatus}</span>
                </td>
                <td>{trial.phase ?? "—"}</td>
                <td>{formatTrialDate(trial.startDate)}</td>
                <td className="cell-num">{trial.enrollmentCount ?? "—"}</td>
                <td className="max-w-sponsor truncate" title={trial.sponsorName ?? ""}>
                  {trial.sponsorName ?? "—"}
                </td>
                <td className="max-w-contact">
                  <div>{trial.centralContact.name ?? "—"}</div>
                  {trial.centralContact.email && (
                    <a
                      className="link-accent text-xs break-all"
                      href={`mailto:${trial.centralContact.email}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {trial.centralContact.email}
                    </a>
                  )}
                </td>
              </tr>
              {expanded === trial.nctId && (
                <tr className="bg-transparent">
                  <td colSpan={10} className="pad-none">
                    <TrialDetail trial={trial} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrialDetail({ trial }: { trial: Trial }) {
  return (
    <div className="detail-panel">
      {trial.officialTitle && (
        <p className="margin-block-sm">
          <strong>Official title:</strong> {trial.officialTitle}
        </p>
      )}
      {trial.primaryPurpose && (
        <p className="margin-block-sm">
          <strong>Primary purpose:</strong> {trial.primaryPurpose}
        </p>
      )}
      <p className="margin-block-sm">
        <strong>Interventions:</strong> {trial.interventionNames.join("; ") || "—"}
      </p>
      <p className="margin-block-sm">
        <strong>Keywords:</strong> {trial.keywords.join(", ") || "—"}
      </p>
      <p className="margin-block-sm">
        <strong>Investigator:</strong> {trial.overallOfficial.name ?? "—"} (
        {trial.overallOfficial.affiliation ?? "—"})
      </p>
      <p className="margin-block-sm">
        <strong>Locations:</strong>
      </p>
      <ul className="margin-block-sm list-disc pl-5">
        {trial.locations.map((l, i) => (
          <li key={i}>
            {[l.facility, l.city, l.state, l.country].filter(Boolean).join(", ")}
          </li>
        ))}
      </ul>
      <p className="margin-block-sm">
        <strong>Eligibility</strong>
      </p>
      <pre className="detail-pre">{trial.eligibilityCriteria ?? "—"}</pre>
    </div>
  );
}

function TrialCards({ trials }: { trials: Trial[] }) {
  return (
    <div className="pad-section">
      {trials.map((trial) => (
        <article key={trial.nctId} className="card-trial">
          <div className="flex justify-between margin-block-sm">
            <a
              className="link-accent font-mono text-sm"
              href={`https://clinicaltrials.gov/study/${trial.nctId}`}
              target="_blank"
              rel="noreferrer"
            >
              {trial.nctId}
            </a>
            <span className={scoreClass(trial.scoreTier)}>{trial.score}</span>
          </div>
          <h3 className="font-medium margin-block-sm">{trial.briefTitle}</h3>
          <p className="text-muted text-sm margin-block-sm">{trial.conditions.join(", ")}</p>
          <div className="flex flex-wrap gap-stack items-center text-sm">
            <span className={statusBadgeClass(trial.overallStatus)}>{trial.overallStatus}</span>
            <span>{trial.phase ?? "—"}</span>
            <span>{formatTrialDate(trial.startDate)}</span>
          </div>
        </article>
      ))}
    </div>
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
