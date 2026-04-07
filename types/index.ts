export type TrialStatus =
  | "NOT_YET_RECRUITING"
  | "RECRUITING"
  | "ENROLLING_BY_INVITATION"
  | "ACTIVE_NOT_RECRUITING"
  | "COMPLETED"
  | "TERMINATED"
  | "WITHDRAWN";

export type Phase = "Phase1" | "Phase2" | "Phase3" | "Phase4" | "NA";

export type InterventionType =
  | "DRUG"
  | "DEVICE"
  | "BEHAVIORAL"
  | "PROCEDURE"
  | "DIAGNOSTIC_TEST"
  | "OTHER";

export type StudyType = "INTERVENTIONAL" | "OBSERVATIONAL";

export type SponsorClass = "INDUSTRY" | "NIH" | "OTHER_GOV" | "OTHER";

export type ScoreTier = "high" | "medium" | "low";

export interface ScoringHints {
  boost_if_condition_contains: string[];
  boost_if_keyword_contains: string[];
  boost_if_eligibility_contains: string[];
  boost_intervention_types: InterventionType[];
  boost_phases: Phase[];
  boost_sponsor_class: SponsorClass[];
  boost_if_enrollment_above: number | null;
}

export interface SearchStrategy {
  conditions_query: string;
  broader_term_query: string | null;
  statuses: TrialStatus[];
  phases: Phase[] | "ANY";
  intervention_types: InterventionType[] | "ANY";
  study_types: StudyType[] | "ANY";
  priority_scoring_hints: ScoringHints;
  rationale: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TrialContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface TrialLocation {
  facility: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface Trial {
  nctId: string;
  briefTitle: string;
  officialTitle: string | null;
  conditions: string[];
  keywords: string[];
  startDate: string | null;
  primaryCompletionDate: string | null;
  studyFirstPostDate: string | null;
  lastUpdatePostDate: string | null;
  overallStatus: TrialStatus;
  phase: Phase | null;
  studyType: StudyType | null;
  interventionTypes: InterventionType[];
  interventionNames: string[];
  primaryPurpose: string | null;
  enrollmentCount: number | null;
  eligibilityCriteria: string | null;
  centralContact: TrialContact;
  overallOfficial: { name: string | null; affiliation: string | null };
  locations: TrialLocation[];
  sponsorName: string | null;
  sponsorClass: SponsorClass | null;
  score: number;
  scoreTier: ScoreTier;
}

export interface TrialsResponse {
  trials: Trial[];
  totalFetched: number;
  capped: boolean;
  zeroResults: boolean;
}

export interface AgentRequest {
  messages: ConversationMessage[];
}

export interface TrialsRequest {
  strategy: SearchStrategy;
}

export interface AgentJsonError {
  error: "agent_malformed_json";
  message: string;
  rawOutput: string;
}

export interface TrialsApiError {
  error: "clinicaltrials_api";
  status: number;
  message: string;
}
