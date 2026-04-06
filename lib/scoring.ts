import type {
  InterventionType,
  Phase,
  ScoreTier,
  ScoringHints,
  SponsorClass,
  Trial,
} from "@/types";

function tierFromScore(score: number): ScoreTier {
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function containsInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function scoreTrial(
  trial: Omit<Trial, "score" | "scoreTier">,
  hints: ScoringHints,
): { score: number; scoreTier: ScoreTier } {
  let score = 0;

  const condJoined = trial.conditions.join(" ");
  for (const term of hints.boost_if_condition_contains) {
    if (term && containsInsensitive(condJoined, term)) score += 3;
  }

  const kwJoined = trial.keywords.join(" ");
  for (const term of hints.boost_if_keyword_contains) {
    if (term && containsInsensitive(kwJoined, term)) score += 2;
  }

  const elig = trial.eligibilityCriteria ?? "";
  for (const term of hints.boost_if_eligibility_contains) {
    if (term && containsInsensitive(elig, term)) score += 2;
  }

  if (hints.boost_intervention_types.length > 0) {
    const hit = trial.interventionTypes.some((t) =>
      hints.boost_intervention_types.includes(t as InterventionType),
    );
    if (hit) score += 2;
  }

  if (trial.phase && hints.boost_phases.includes(trial.phase as Phase)) {
    score += 1;
  }

  if (
    trial.sponsorClass &&
    hints.boost_sponsor_class.includes(trial.sponsorClass as SponsorClass)
  ) {
    score += 1;
  }

  if (
    hints.boost_if_enrollment_above != null &&
    trial.enrollmentCount != null &&
    trial.enrollmentCount > hints.boost_if_enrollment_above
  ) {
    score += 1;
  }

  return { score, scoreTier: tierFromScore(score) };
}
