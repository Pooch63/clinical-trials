"use client";

import type { ConversationMessage, SearchStrategy, TrialsResponse } from "@/types";
import {
  readClinicalSessionSnapshot,
  writeClinicalSessionSnapshot,
  type ClinicalSessionSortDir,
  type ClinicalSessionSortKey,
  type PersistedChatTurn,
} from "@/lib/conversationLocalHistory";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClinicalTrialVisualizer,
  createDefaultTableFilters,
  downloadCsv,
  trialMatchesTableFilters,
  trialsToCsv,
} from "./ClinicalTrialVisualizer";
import type { TableFilterRow } from "./ClinicalTrialVisualizer";
import { ClinicalTrialsChat } from "./ClinicalTrialsChat";

const ROWS_PER_PAGE = 100;

async function fetchTrialsApi(strategy: SearchStrategy): Promise<
  { ok: true; data: TrialsResponse } | { ok: false; message: string }
> {
  let trialsResponse: Response;
  try {
    trialsResponse = await fetch("/api/trials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy }),
    });
  } catch {
    return { ok: false, message: "Could not reach trials service." };
  }
  const tr = (await trialsResponse.json()) as TrialsResponse & { error?: string; message?: string };
  if (!trialsResponse.ok) {
    return { ok: false, message: tr.message ?? "ClinicalTrials.gov request failed" };
  }
  return { ok: true, data: tr };
}

export function ClinicalTrialsApp() {
  const [active, setActive] = useState(false);
  const [heroInput, setHeroInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [turns, setTurns] = useState<PersistedChatTurn[]>([]);
  const [agentDebug, setAgentDebug] = useState(
    () => process.env.NEXT_PUBLIC_AGENT_DEBUG === "1",
  );
  const [loadingPhase, setLoadingPhase] = useState<"idle" | "agent" | "trials">("idle");
  const [trialsRes, setTrialsRes] = useState<TrialsResponse | null>(null);
  const [lastStrategy, setLastStrategy] = useState<SearchStrategy | null>(null);
  const [trialsError, setTrialsError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<ClinicalSessionSortKey>("score");
  const [sortDir, setSortDir] = useState<ClinicalSessionSortDir>("desc");
  const [tableFilters, setTableFilters] = useState<TableFilterRow[]>(() =>
    createDefaultTableFilters(),
  );
  const [tablePage, setTablePage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionHydrated, setSessionHydrated] = useState(false);

  // CONVERSATION_LOCAL_HISTORY — hydrate from localStorage once (client)
  useEffect(() => {
    const snap = readClinicalSessionSnapshot();
    if (snap) {
      setActive(snap.active);
      setHeroInput(snap.heroInput);
      setChatInput(snap.chatInput);
      setConversation(snap.conversation);
      setTurns(snap.turns);
      setAgentDebug(snap.agentDebug);
      setTrialsRes(snap.trialsRes);
      setLastStrategy(snap.lastStrategy);
      setTrialsError(snap.trialsError);
      setExpanded(snap.expanded);
      setSortKey(snap.sortKey);
      setSortDir(snap.sortDir);
    }
    setSessionHydrated(true);
  }, []);

  // CONVERSATION_LOCAL_HISTORY — persist session (debounced)
  useEffect(() => {
    if (!sessionHydrated) return;
    const id = window.setTimeout(() => {
      writeClinicalSessionSnapshot({
        v: 1,
        active,
        heroInput,
        chatInput,
        conversation,
        turns,
        agentDebug,
        trialsRes,
        lastStrategy,
        trialsError,
        expanded,
        sortKey,
        sortDir,
      });
    }, 400);
    return () => window.clearTimeout(id);
  }, [
    sessionHydrated,
    active,
    heroInput,
    chatInput,
    conversation,
    turns,
    agentDebug,
    trialsRes,
    lastStrategy,
    trialsError,
    expanded,
    sortKey,
    sortDir,
  ]);

  const filteredTrials = useMemo(() => {
    const list = trialsRes?.trials ?? [];
    if (!tableFilters.length) return [...list];
    return list.filter((t) => trialMatchesTableFilters(t, tableFilters));
  }, [trialsRes, tableFilters]);

  const displaySortedTrials = useMemo(() => {
    const list = [...filteredTrials];
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
  }, [filteredTrials, sortKey, sortDir]);

  const filteredCount = displaySortedTrials.length;
  const totalTablePages = Math.max(1, Math.ceil(filteredCount / ROWS_PER_PAGE));
  const visibleTablePage = Math.min(tablePage, totalTablePages);
  const pageStart = filteredCount === 0 ? 0 : (visibleTablePage - 1) * ROWS_PER_PAGE + 1;
  const pageEnd = Math.min(filteredCount, visibleTablePage * ROWS_PER_PAGE);

  const paginatedTrials = useMemo(() => {
    const start = (visibleTablePage - 1) * ROWS_PER_PAGE;
    return displaySortedTrials.slice(start, start + ROWS_PER_PAGE);
  }, [displaySortedTrials, visibleTablePage]);

  useEffect(() => {
    setTablePage((p) => Math.min(p, totalTablePages));
  }, [totalTablePages]);

  useEffect(() => {
    setTablePage(1);
  }, [tableFilters]);

  const addTableFilterRow = useCallback(() => {
    setTableFilters((rows) => [
      ...rows,
      { id: crypto.randomUUID(), field: "nctId", operator: "contains", value: "" },
    ]);
  }, []);

  const updateTableFilterRow = useCallback((id: string, patch: Partial<Omit<TableFilterRow, "id">>) => {
    setTableFilters((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const removeTableFilterRow = useCallback((id: string) => {
    setTableFilters((rows) => rows.filter((r) => r.id !== id));
  }, []);

  const exportFilteredCsv = useCallback(() => {
    if (!displaySortedTrials.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`clinical-trials-${stamp}.csv`, trialsToCsv(displaySortedTrials));
  }, [displaySortedTrials]);

  const strategyForTrialRetry = useMemo(() => {
    if (lastStrategy) return lastStrategy;
    for (let i = turns.length - 1; i >= 0; i--) {
      const s = turns[i]?.submittedStrategy;
      if (s) return s;
    }
    return null;
  }, [lastStrategy, turns]);

  const canRetryTrialsFetch =
    strategyForTrialRetry != null &&
    (trialsError != null ||
      (!trialsRes && turns.some((t) => t.submittedStrategy !== undefined)));

  const retryFetchTrials = useCallback(async () => {
    const strategy = strategyForTrialRetry;
    if (!strategy) return;
    setLoadingPhase("trials");
    setTrialsError(null);
    const result = await fetchTrialsApi(strategy);
    if (!result.ok) {
      setTrialsError(result.message);
      setLoadingPhase("idle");
      return;
    }
    setTrialsRes(result.data);
    setLastStrategy(strategy);
    setLoadingPhase("idle");
  }, [strategyForTrialRetry]);

  const toggleSort = (key: ClinicalSessionSortKey) => {
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
        const trialResult = await fetchTrialsApi(strategy);
        if (!trialResult.ok) {
          setTrialsError(trialResult.message);
          setLoadingPhase("idle");
          return;
        }
        setTrialsRes(trialResult.data);
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

  return (
    <div className="surface-page min-h-screen">
      {!active && (
        <ClinicalTrialsChat
          active={false}
          heroInput={heroInput}
          setHeroInput={setHeroInput}
          chatInput={chatInput}
          setChatInput={setChatInput}
          turns={turns}
          agentDebug={agentDebug}
          setAgentDebug={setAgentDebug}
          drawerOpen={drawerOpen}
          setDrawerOpen={setDrawerOpen}
          loadingPhase={loadingPhase}
          onSubmit={submit}
        />
      )}

      {active && (
        <div className="layout-split h-screen min-h-0 overflow-hidden">
          <ClinicalTrialsChat
            active
            heroInput={heroInput}
            setHeroInput={setHeroInput}
            chatInput={chatInput}
            setChatInput={setChatInput}
            turns={turns}
            agentDebug={agentDebug}
            setAgentDebug={setAgentDebug}
            drawerOpen={drawerOpen}
            setDrawerOpen={setDrawerOpen}
            loadingPhase={loadingPhase}
            onSubmit={submit}
          />
          <ClinicalTrialVisualizer
            loadingPhase={loadingPhase}
            trialsError={trialsError}
            onDismissError={() => setTrialsError(null)}
            trialsRes={trialsRes}
            lastStrategy={lastStrategy}
            turns={turns}
            canRetryTrialsFetch={canRetryTrialsFetch}
            onRetryTrialsFetch={retryFetchTrials}
            filteredCount={filteredCount}
            tableFilters={tableFilters}
            onAddTableFilterRow={addTableFilterRow}
            onUpdateTableFilterRow={updateTableFilterRow}
            onRemoveTableFilterRow={removeTableFilterRow}
            onExportFilteredCsv={exportFilteredCsv}
            displaySortedTrialsLength={displaySortedTrials.length}
            visibleTablePage={visibleTablePage}
            totalTablePages={totalTablePages}
            pageStart={pageStart}
            pageEnd={pageEnd}
            onPrevTablePage={() => setTablePage((p) => Math.max(1, p - 1))}
            onNextTablePage={() => setTablePage((p) => Math.min(totalTablePages, p + 1))}
            paginatedTrials={paginatedTrials}
            sortKey={sortKey}
            sortDir={sortDir}
            onToggleSort={toggleSort}
            expanded={expanded}
            onToggleRow={(id) => setExpanded((e) => (e === id ? null : id))}
          />
        </div>
      )}
    </div>
  );
}
