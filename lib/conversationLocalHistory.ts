/**
 * Local session persistence (localStorage). Quick MVP — easy to remove later:
 * delete this file, remove the `conversationLocalHistory` import and the two
 * `useEffect` blocks marked `CONVERSATION_LOCAL_HISTORY` in `components/ClinicalTrialsApp.tsx`.
 */
import type { ConversationMessage, SearchStrategy, TrialsResponse } from "@/types";

const STORAGE_KEY = "clinical-trials.session.v1";
const MAX_BYTES_SOFT = 4_500_000;

export type ClinicalSessionSortKey = "score" | "startDate" | "enrollment";
export type ClinicalSessionSortDir = "asc" | "desc";

export interface PersistedChatTurn {
  id: string;
  prompt: string;
  ts: number;
  streamText?: string;
  streamError?: boolean;
  submittedStrategy?: SearchStrategy;
  agentMalformedRaw?: string;
}

export interface ClinicalSessionSnapshot {
  v: 1;
  active: boolean;
  heroInput: string;
  chatInput: string;
  conversation: ConversationMessage[];
  turns: PersistedChatTurn[];
  agentDebug: boolean;
  trialsRes: TrialsResponse | null;
  lastStrategy: SearchStrategy | null;
  trialsError: string | null;
  expanded: string | null;
  sortKey: ClinicalSessionSortKey;
  sortDir: ClinicalSessionSortDir;
}

function byteLengthUtf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

function isSnapshot(x: unknown): x is ClinicalSessionSnapshot {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return o.v === 1 && Array.isArray(o.conversation) && Array.isArray(o.turns);
}

export function readClinicalSessionSnapshot(): ClinicalSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!isSnapshot(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function trySetItem(json: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, json);
    return true;
  } catch {
    return false;
  }
}

export function writeClinicalSessionSnapshot(snapshot: ClinicalSessionSnapshot): void {
  if (typeof window === "undefined") return;

  const attempt = (s: ClinicalSessionSnapshot): boolean => {
    try {
      const json = JSON.stringify(s);
      if (byteLengthUtf8(json) > MAX_BYTES_SOFT && s.trialsRes) {
        return attempt({ ...s, trialsRes: null });
      }
      return trySetItem(json);
    } catch {
      return false;
    }
  };

  if (!attempt(snapshot) && snapshot.trialsRes) {
    attempt({ ...snapshot, trialsRes: null });
  }
}

export function clearClinicalSessionSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
