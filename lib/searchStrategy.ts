import type {
  InterventionType,
  Phase,
  SearchStrategy,
  SponsorClass,
  StudyType,
  TrialStatus,
} from "@/types";

const STATUSES: TrialStatus[] = [
  "NOT_YET_RECRUITING",
  "RECRUITING",
  "ENROLLING_BY_INVITATION",
  "ACTIVE_NOT_RECRUITING",
  "COMPLETED",
  "TERMINATED",
  "WITHDRAWN",
];

const PHASES: Phase[] = ["Phase1", "Phase2", "Phase3", "Phase4", "NA"];

const INTERVENTION_TYPES: InterventionType[] = [
  "DRUG",
  "DEVICE",
  "BEHAVIORAL",
  "PROCEDURE",
  "DIAGNOSTIC_TEST",
  "OTHER",
];

const STUDY_TYPES: StudyType[] = ["INTERVENTIONAL", "OBSERVATIONAL"];

const SPONSOR: SponsorClass[] = ["INDUSTRY", "NIH", "OTHER_GOV", "OTHER"];

function isScoringHints(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const h = x as Record<string, unknown>;
  return (
    Array.isArray(h.boost_if_condition_contains) &&
    h.boost_if_condition_contains.every((s) => typeof s === "string") &&
    Array.isArray(h.boost_if_keyword_contains) &&
    h.boost_if_keyword_contains.every((s) => typeof s === "string") &&
    Array.isArray(h.boost_if_eligibility_contains) &&
    h.boost_if_eligibility_contains.every((s) => typeof s === "string") &&
    Array.isArray(h.boost_intervention_types) &&
    h.boost_intervention_types.every((t) => INTERVENTION_TYPES.includes(t as InterventionType)) &&
    Array.isArray(h.boost_phases) &&
    h.boost_phases.every((p) => PHASES.includes(p as Phase)) &&
    Array.isArray(h.boost_sponsor_class) &&
    h.boost_sponsor_class.every((s) => SPONSOR.includes(s as SponsorClass)) &&
    (h.boost_if_enrollment_above === null || typeof h.boost_if_enrollment_above === "number")
  );
}

export function isSearchStrategy(x: unknown): x is SearchStrategy {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.conditions_query !== "string") return false;
  if (o.broader_term_query !== null && typeof o.broader_term_query !== "string") return false;
  if (typeof o.rationale !== "string") return false;
  if (!Array.isArray(o.statuses) || !o.statuses.every((s) => STATUSES.includes(s as TrialStatus))) {
    return false;
  }
  if (o.phases === "ANY") {
    /* ok */
  } else if (
    Array.isArray(o.phases) &&
    o.phases.length > 0 &&
    o.phases.every((p) => PHASES.includes(p as Phase))
  ) {
    /* ok */
  } else {
    return false;
  }
  if (o.intervention_types === "ANY") {
    /* ok */
  } else if (
    Array.isArray(o.intervention_types) &&
    o.intervention_types.length > 0 &&
    o.intervention_types.every((t) => INTERVENTION_TYPES.includes(t as InterventionType))
  ) {
    /* ok */
  } else {
    return false;
  }
  if (o.study_types === "ANY") {
    /* ok */
  } else if (
    Array.isArray(o.study_types) &&
    o.study_types.length > 0 &&
    o.study_types.every((s) => STUDY_TYPES.includes(s as StudyType))
  ) {
    /* ok */
  } else {
    return false;
  }
  return isScoringHints(o.priority_scoring_hints);
}

export function parseStrategyFromText(raw: string): SearchStrategy | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isSearchStrategy(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}
