"use client";

import type {
  ClinicalSessionSortDir,
  ClinicalSessionSortKey,
  PersistedChatTurn,
} from "@/lib/conversationLocalHistory";
import type { SearchStrategy, Trial, TrialsResponse } from "@/types";
import { Fragment } from "react";

type TableSearchField =
  | "nctId"
  | "title"
  | "conditions"
  | "status"
  | "phase"
  | "start"
  | "enrollment"
  | "sponsor"
  | "contact";

export type TableFilterOperator = "contains" | "not" | "is" | "gt";

export type TableFilterRow = {
  id: string;
  field: TableSearchField;
  operator: TableFilterOperator;
  value: string;
};

/** ISO calendar date (YYYY-MM-DD) for `n` years before today (local). */
export function dateYearsAgoIso(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/** Default toolbar filters: exclude ACTIVE_NOT_RECRUITING; start date after ~2 years ago. */
export function createDefaultTableFilters(): TableFilterRow[] {
  const boundary = dateYearsAgoIso(2);
  return [
    {
      id: crypto.randomUUID(),
      field: "status",
      operator: "not",
      value: "ACTIVE_NOT_RECRUITING",
    },
    {
      id: crypto.randomUUID(),
      field: "start",
      operator: "gt",
      value: boundary,
    },
  ];
}

const TABLE_SEARCH_FIELDS: { value: TableSearchField; label: string }[] = [
  { value: "nctId", label: "NCT ID" },
  { value: "title", label: "Title" },
  { value: "conditions", label: "Condition(s)" },
  { value: "status", label: "Status" },
  { value: "phase", label: "Phase" },
  { value: "start", label: "Start" },
  { value: "enrollment", label: "N" },
  { value: "sponsor", label: "Sponsor" },
  { value: "contact", label: "Contact" },
];

const TABLE_OPERATORS_GENERAL: { value: TableFilterOperator; label: string }[] = [
  { value: "contains", label: "Contains" },
  { value: "not", label: "Not" },
  { value: "is", label: "Is" },
];

const TABLE_OPERATORS_START: { value: TableFilterOperator; label: string }[] = [
  ...TABLE_OPERATORS_GENERAL,
  { value: "gt", label: "> (after date)" },
];

function normalizeFilterText(s: string): string {
  return s.trim().toLowerCase();
}

/** Parse YYYY-MM-DD to UTC midnight timestamp for stable comparisons. */
function dateInputToUtcMs(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

/** Best-effort start date for comparison (month-only uses first of month). */
function trialStartDateUtcMs(startDate: string | null): number | null {
  if (!startDate) return null;
  const d = new Date(startDate);
  if (!Number.isNaN(d.getTime())) {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(startDate.trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const day = m[3] ? parseInt(m[3], 10) : 1;
  return Date.UTC(y, mo, day);
}

function trialSearchText(trial: Trial, field: TableSearchField): string {
  switch (field) {
    case "nctId":
      return trial.nctId;
    case "title":
      return trial.briefTitle;
    case "conditions":
      return trial.conditions.join(" ");
    case "status":
      return trial.overallStatus;
    case "phase":
      return trial.phase ?? "";
    case "start":
      return [trial.startDate ?? "", formatTrialDate(trial.startDate)].filter(Boolean).join(" ");
    case "enrollment":
      return trial.enrollmentCount != null ? String(trial.enrollmentCount) : "";
    case "sponsor":
      return trial.sponsorName ?? "";
    case "contact":
      return [
        trial.centralContact.name,
        trial.centralContact.email,
        trial.centralContact.phone,
      ]
        .filter(Boolean)
        .join(" ");
    default:
      return "";
  }
}

function trialMatchesOneFilter(trial: Trial, f: TableFilterRow): boolean {
  const op = f.operator;
  const raw = f.value.trim();

  if (op === "gt") {
    if (f.field !== "start") return true;
    if (!raw) return true;
    const threshold = dateInputToUtcMs(raw);
    if (threshold == null) return true;
    const tMs = trialStartDateUtcMs(trial.startDate);
    if (tMs == null) return false;
    return tMs > threshold;
  }

  if (!raw) return true;

  const hay = trialSearchText(trial, f.field);
  const hl = hay.toLowerCase();
  const ql = raw.toLowerCase();

  switch (op) {
    case "contains":
      return hl.includes(ql);
    case "not":
      return !hl.includes(ql);
    case "is": {
      if (f.field === "conditions") {
        const n = normalizeFilterText(raw);
        return trial.conditions.some((c) => normalizeFilterText(c) === n);
      }
      if (f.field === "nctId") {
        return trial.nctId.toUpperCase() === raw.toUpperCase();
      }
      if (f.field === "enrollment") {
        if (trial.enrollmentCount == null) return false;
        return String(trial.enrollmentCount) === raw.trim();
      }
      return normalizeFilterText(hay) === normalizeFilterText(raw);
    }
    default:
      return true;
  }
}

export function trialMatchesTableFilters(trial: Trial, filters: TableFilterRow[]): boolean {
  for (const f of filters) {
    if (!trialMatchesOneFilter(trial, f)) return false;
  }
  return true;
}

function escapeCsvCell(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function trialsToCsv(trials: Trial[]): string {
  const headers = [
    "Score",
    "NCT ID",
    "Title",
    "Condition(s)",
    "Status",
    "Phase",
    "Start",
    "N",
    "Sponsor",
    "Contact name",
    "Contact email",
    "Contact phone",
  ];
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const t of trials) {
    const row = [
      String(t.score),
      t.nctId,
      t.briefTitle,
      t.conditions.join("; "),
      t.overallStatus,
      t.phase ?? "",
      formatTrialDate(t.startDate),
      t.enrollmentCount != null ? String(t.enrollmentCount) : "",
      t.sponsorName ?? "",
      t.centralContact.name ?? "",
      t.centralContact.email ?? "",
      t.centralContact.phone ?? "",
    ];
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatTrialDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString("en", { month: "short", year: "numeric" });
  }
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (m) {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
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

export type ClinicalTrialVisualizerProps = {
  loadingPhase: "idle" | "agent" | "trials";
  trialsError: string | null;
  onDismissError: () => void;
  trialsRes: TrialsResponse | null;
  lastStrategy: SearchStrategy | null;
  turns: PersistedChatTurn[];
  canRetryTrialsFetch: boolean;
  onRetryTrialsFetch: () => void;
  filteredCount: number;
  tableFilters: TableFilterRow[];
  onAddTableFilterRow: () => void;
  onUpdateTableFilterRow: (id: string, patch: Partial<Omit<TableFilterRow, "id">>) => void;
  onRemoveTableFilterRow: (id: string) => void;
  onExportFilteredCsv: () => void;
  displaySortedTrialsLength: number;
  visibleTablePage: number;
  totalTablePages: number;
  pageStart: number;
  pageEnd: number;
  onPrevTablePage: () => void;
  onNextTablePage: () => void;
  paginatedTrials: Trial[];
  sortKey: ClinicalSessionSortKey;
  sortDir: ClinicalSessionSortDir;
  onToggleSort: (key: ClinicalSessionSortKey) => void;
  expanded: string | null;
  onToggleRow: (id: string) => void;
};

export function ClinicalTrialVisualizer({
  loadingPhase,
  trialsError,
  onDismissError,
  trialsRes,
  lastStrategy,
  turns,
  canRetryTrialsFetch,
  onRetryTrialsFetch,
  filteredCount,
  tableFilters,
  onAddTableFilterRow,
  onUpdateTableFilterRow,
  onRemoveTableFilterRow,
  onExportFilteredCsv,
  displaySortedTrialsLength,
  visibleTablePage,
  totalTablePages,
  pageStart,
  pageEnd,
  onPrevTablePage,
  onNextTablePage,
  paginatedTrials,
  sortKey,
  sortDir,
  onToggleSort,
  expanded,
  onToggleRow,
}: ClinicalTrialVisualizerProps) {
  return (
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
          <div className="margin-block-md flex flex-wrap justify-center gap-stack">
            {canRetryTrialsFetch && (
              <button
                type="button"
                className="border-default pad-input text-accent"
                onClick={() => void onRetryTrialsFetch()}
              >
                Retry fetch trials
              </button>
            )}
            <button
              type="button"
              className="border-default pad-input text-muted"
              onClick={onDismissError}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loadingPhase === "idle" && !trialsError && trialsRes && trialsRes.trials.length > 0 && (
        <div className="flex flex-1 flex-col overflow-hidden pad-page">
          <div className="margin-block-md flex flex-wrap items-baseline justify-between gap-stack">
            <p className="text-muted">
              {trialsRes.totalFetched} trials found
              {trialsRes.capped ? " (results capped at 5,000)" : ""} · sorted by relevance
              {filteredCount !== trialsRes.trials.length && (
                <span> · {filteredCount} match current filters</span>
              )}
            </p>
          </div>
          <TrialTableToolbar
            filters={tableFilters}
            onAddField={onAddTableFilterRow}
            onUpdateRow={onUpdateTableFilterRow}
            onRemoveRow={onRemoveTableFilterRow}
            onExportCsv={onExportFilteredCsv}
            exportDisabled={displaySortedTrialsLength === 0}
            visiblePage={visibleTablePage}
            totalPages={totalTablePages}
            pageStart={pageStart}
            pageEnd={pageEnd}
            filteredCount={filteredCount}
            onPrevPage={onPrevTablePage}
            onNextPage={onNextTablePage}
          />
          {lastStrategy && <ScoringLegend strategy={lastStrategy} />}
          <div className="desktop-only flex-1 overflow-hidden">
            <TrialTableDesktop
              trials={paginatedTrials}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onToggleSort}
              expanded={expanded}
              onToggleRow={onToggleRow}
            />
          </div>
          <div className="mobile-only flex-1 overflow-y-auto">
            <TrialCards trials={paginatedTrials} />
          </div>
        </div>
      )}

      {loadingPhase === "idle" && !trialsError && trialsRes?.zeroResults && lastStrategy && (
        <div className="state-center">
          <p className="text-muted text-center max-w-md">
            No trials matched after filtering. Try broadening your condition terms or relaxing phase
            and status filters in a follow-up message.
          </p>
        </div>
      )}

      {loadingPhase === "idle" && !trialsRes && !trialsError && (
        <div className="state-center">
          <p className="text-muted text-center max-w-sm">
            {canRetryTrialsFetch
              ? "Trial results are not loaded (for example after a failed fetch or trimmed local save). You can retry with the last search strategy from this chat."
              : turns.some((t) => t.streamText)
                ? "When the agent has enough context, trial results will appear here."
                : "Waiting for the agent to return a search strategy."}
          </p>
          {canRetryTrialsFetch && (
            <button
              type="button"
              className="border-default pad-input text-accent margin-block-md"
              onClick={() => void onRetryTrialsFetch()}
            >
              Retry fetch trials
            </button>
          )}
        </div>
      )}
    </main>
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

function TrialTableToolbar({
  filters,
  onAddField,
  onUpdateRow,
  onRemoveRow,
  onExportCsv,
  exportDisabled,
  visiblePage,
  totalPages,
  pageStart,
  pageEnd,
  filteredCount,
  onPrevPage,
  onNextPage,
}: {
  filters: TableFilterRow[];
  onAddField: () => void;
  onUpdateRow: (id: string, patch: Partial<Omit<TableFilterRow, "id">>) => void;
  onRemoveRow: (id: string) => void;
  onExportCsv: () => void;
  exportDisabled: boolean;
  visiblePage: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  filteredCount: number;
  onPrevPage: () => void;
  onNextPage: () => void;
}) {
  return (
    <div className="trial-toolbar margin-block-md flex flex-col gap-stack border-default surface-elevated pad-section">
      <div className="flex flex-wrap items-center justify-between gap-stack">
        <p className="text-sm font-medium text-accent">Search rows</p>
        <div className="flex flex-wrap items-center gap-stack">
          <button type="button" className="border-default pad-input text-sm" onClick={onAddField}>
            Add field
          </button>
          <button
            type="button"
            className="border-default pad-input text-sm text-accent"
            disabled={exportDisabled}
            onClick={onExportCsv}
          >
            Export CSV
          </button>
        </div>
      </div>
      {filters.length === 0 && (
        <p className="text-muted text-sm">
          No field filters — showing all loaded trials. Use &quot;Add field&quot; to filter by NCT ID,
          title, condition, status, phase, start date, enrollment, sponsor, or contact. Use the operator
          menu for contains / not / is, or &gt; (after date) on Start.
        </p>
      )}
      {filters.length > 0 && (
        <ul className="flex flex-col gap-stack">
          {filters.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2">
              <select
                className="input-field min-w-[10rem] text-sm pad-input-sm"
                aria-label="Field to search"
                value={row.field}
                onChange={(e) => {
                  const field = e.target.value as TableSearchField;
                  if (field !== "start" && row.operator === "gt") {
                    onUpdateRow(row.id, { field, operator: "contains" });
                  } else {
                    onUpdateRow(row.id, { field });
                  }
                }}
              >
                {TABLE_SEARCH_FIELDS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <select
                className="input-field min-w-[9rem] text-sm pad-input-sm"
                aria-label="Match operator"
                value={row.operator}
                onChange={(e) => {
                  const operator = e.target.value as TableFilterOperator;
                  if (operator === "gt") {
                    const v = row.value.trim();
                    const next =
                      /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : dateYearsAgoIso(2);
                    onUpdateRow(row.id, { operator, value: next });
                  } else {
                    onUpdateRow(row.id, { operator });
                  }
                }}
              >
                {(row.field === "start" ? TABLE_OPERATORS_START : TABLE_OPERATORS_GENERAL).map(
                  (opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ),
                )}
              </select>
              {row.operator === "gt" && row.field === "start" ? (
                <input
                  type="date"
                  className="input-field flex-1 min-w-[8rem] text-sm pad-input-sm"
                  aria-label="Show trials with start date after this date"
                  value={/^\d{4}-\d{2}-\d{2}$/.test(row.value.trim()) ? row.value.trim() : ""}
                  onChange={(e) => onUpdateRow(row.id, { value: e.target.value })}
                />
              ) : (
                <input
                  type="search"
                  className="input-field flex-1 min-w-[8rem] text-sm pad-input-sm"
                  placeholder={
                    row.operator === "contains"
                      ? "Contains…"
                      : row.operator === "not"
                        ? "Exclude rows containing…"
                        : "Exact match…"
                  }
                  value={row.value}
                  onChange={(e) => onUpdateRow(row.id, { value: e.target.value })}
                />
              )}
              <button
                type="button"
                className="border-default pad-input-sm text-sm text-muted"
                aria-label="Remove this filter"
                onClick={() => onRemoveRow(row.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted text-sm">
        {filteredCount === 0
          ? "No rows match the current filters."
          : `Showing ${pageStart}–${pageEnd} of ${filteredCount} (page ${visiblePage} of ${totalPages})`}
      </p>
      <div className="flex flex-wrap items-center gap-stack">
        <button
          type="button"
          className="border-default pad-input text-sm"
          disabled={visiblePage <= 1}
          onClick={onPrevPage}
        >
          Previous
        </button>
        <button
          type="button"
          className="border-default pad-input text-sm"
          disabled={visiblePage >= totalPages}
          onClick={onNextPage}
        >
          Next
        </button>
      </div>
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
  sortKey: ClinicalSessionSortKey;
  sortDir: ClinicalSessionSortDir;
  onSort: (k: ClinicalSessionSortKey) => void;
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
