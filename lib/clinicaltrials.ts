import { CONSTANT_FIELDS, CT_BASE, MAX_TRIALS_FETCH } from "@/lib/constants";
import { scoreTrial } from "@/lib/scoring";
import type {
  InterventionType,
  Phase,
  SearchStrategy,
  SponsorClass,
  StudyType,
  Trial,
  TrialContact,
  TrialLocation,
  TrialStatus,
  TrialsResponse,
} from "@/types";

interface V2StudiesResponse {
  studies?: unknown[];
  nextPageToken?: string;
}

function mapOverallStatus(raw: string | undefined): TrialStatus {
  const s = raw ?? "";
  const allowed: TrialStatus[] = [
    "NOT_YET_RECRUITING",
    "RECRUITING",
    "ENROLLING_BY_INVITATION",
    "ACTIVE_NOT_RECRUITING",
    "COMPLETED",
    "TERMINATED",
    "WITHDRAWN",
  ];
  if (allowed.includes(s as TrialStatus)) return s as TrialStatus;
  return "ACTIVE_NOT_RECRUITING";
}

function mapPhase(p: string | undefined): Phase | null {
  if (!p) return null;
  const map: Record<string, Phase> = {
    EARLY_PHASE1: "PHASE1",
    PHASE1: "PHASE1",
    PHASE2: "PHASE2",
    PHASE3: "PHASE3",
    PHASE4: "PHASE4",
    NA: "NA",
  };
  return map[p] ?? null;
}

function mapInterventionType(t: string | undefined): InterventionType | null {
  if (!t) return null;
  const allowed: InterventionType[] = [
    "DRUG",
    "DEVICE",
    "BEHAVIORAL",
    "PROCEDURE",
    "DIAGNOSTIC_TEST",
    "OTHER",
  ];
  return allowed.includes(t as InterventionType) ? (t as InterventionType) : "OTHER";
}

function mapSponsorClass(c: string | undefined): SponsorClass | null {
  if (!c) return null;
  const map: Record<string, SponsorClass> = {
    INDUSTRY: "INDUSTRY",
    NIH: "NIH",
    FED: "OTHER_GOV",
    OTHER_GOV: "OTHER_GOV",
    NETWORK: "OTHER",
    OTHER: "OTHER",
    UNKNOWN: "OTHER",
  };
  return map[c] ?? "OTHER";
}

function parseStudy(raw: unknown): Omit<Trial, "score" | "scoreTier"> | null {
  if (!raw || typeof raw !== "object") return null;
  const ps = (raw as { protocolSection?: Record<string, unknown> }).protocolSection;
  if (!ps) return null;

  const id = ps.identificationModule as Record<string, unknown> | undefined;
  const status = ps.statusModule as Record<string, unknown> | undefined;
  const conditions = ps.conditionsModule as Record<string, unknown> | undefined;
  const design = ps.designModule as Record<string, unknown> | undefined;
  const arms = ps.armsInterventionsModule as Record<string, unknown> | undefined;
  const eligibility = ps.eligibilityModule as Record<string, unknown> | undefined;
  const contacts = ps.contactsLocationsModule as Record<string, unknown> | undefined;
  const sponsor = ps.sponsorCollaboratorsModule as Record<string, unknown> | undefined;

  const nctId = (id?.nctId as string) ?? "";
  if (!nctId) return null;

  const interventions = (arms?.interventions as Array<Record<string, unknown>>) ?? [];
  const interventionTypes: InterventionType[] = [];
  const interventionNames: string[] = [];
  for (const iv of interventions) {
    const typ = mapInterventionType(iv.type as string | undefined);
    if (typ && !interventionTypes.includes(typ)) interventionTypes.push(typ);
    const name = iv.name as string | undefined;
    if (name) interventionNames.push(name);
  }

  const phasesRaw = design?.phases as string[] | undefined;
  const phase = phasesRaw?.length ? mapPhase(phasesRaw[0]) : null;

  const designInfo = design?.designInfo as Record<string, unknown> | undefined;
  const primaryPurpose = (designInfo?.primaryPurpose as string) ?? null;

  const lead = sponsor?.leadSponsor as Record<string, unknown> | undefined;

  const centralContacts = (contacts?.centralContacts as Array<Record<string, unknown>>) ?? [];
  const firstContact = centralContacts[0];
  const centralContact: TrialContact = {
    name: (firstContact?.name as string) ?? null,
    email: (firstContact?.email as string) ?? null,
    phone: (firstContact?.phone as string) ?? null,
  };

  const officials = (contacts?.overallOfficials as Array<Record<string, unknown>>) ?? [];
  const firstOff = officials[0];
  const overallOfficial = {
    name: (firstOff?.name as string) ?? null,
    affiliation: (firstOff?.affiliation as string) ?? null,
  };

  const locs = (contacts?.locations as Array<Record<string, unknown>>) ?? [];
  const locations: TrialLocation[] = locs.map((l) => ({
    facility: (l.facility as string) ?? null,
    city: (l.city as string) ?? null,
    state: (l.state as string) ?? null,
    country: (l.country as string) ?? null,
  }));

  const enrollmentInfo = design?.enrollmentInfo as Record<string, unknown> | undefined;
  const enrollmentCount =
    typeof enrollmentInfo?.count === "number" ? (enrollmentInfo.count as number) : null;

  const startDateStruct = status?.startDateStruct as Record<string, unknown> | undefined;
  const primaryCompletionDateStruct = status?.primaryCompletionDateStruct as
    | Record<string, unknown>
    | undefined;
  const studyFirstPostDateStruct = status?.studyFirstPostDateStruct as
    | Record<string, unknown>
    | undefined;
  const lastUpdatePostDateStruct = status?.lastUpdatePostDateStruct as
    | Record<string, unknown>
    | undefined;

  return {
    nctId,
    briefTitle: (id?.briefTitle as string) ?? "",
    officialTitle: (id?.officialTitle as string) ?? null,
    conditions: (conditions?.conditions as string[]) ?? [],
    keywords: (conditions?.keywords as string[]) ?? [],
    startDate: (startDateStruct?.date as string) ?? null,
    primaryCompletionDate: (primaryCompletionDateStruct?.date as string) ?? null,
    studyFirstPostDate: (studyFirstPostDateStruct?.date as string) ?? null,
    lastUpdatePostDate: (lastUpdatePostDateStruct?.date as string) ?? null,
    overallStatus: mapOverallStatus(status?.overallStatus as string | undefined),
    phase,
    studyType: (design?.studyType as StudyType) ?? null,
    interventionTypes,
    interventionNames,
    primaryPurpose,
    enrollmentCount,
    eligibilityCriteria: (eligibility?.eligibilityCriteria as string) ?? null,
    centralContact,
    overallOfficial,
    locations,
    sponsorName: (lead?.name as string) ?? null,
    sponsorClass: mapSponsorClass(lead?.class as string | undefined),
  };
}

function passesPostFilters(
  trial: Omit<Trial, "score" | "scoreTier">,
  strategy: SearchStrategy,
): boolean {
  if (strategy.intervention_types !== "ANY") {
    const wanted = strategy.intervention_types;
    const ok = trial.interventionTypes.some((t) => wanted.includes(t));
    if (!ok) return false;
  }
  if (strategy.study_types !== "ANY") {
    const st = trial.studyType;
    if (!st || !strategy.study_types.includes(st)) return false;
  }
  return true;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchAllStudies(
  strategy: SearchStrategy,
): Promise<{ studies: unknown[]; capped: boolean; fetchError?: { status: number; message: string } }> {
  const params: Record<string, string> = {
    "query.cond": strategy.conditions_query,
    "filter.overallStatus": strategy.statuses.join(","),
    fields: CONSTANT_FIELDS.join(","),
    pageSize: "1000",
    format: "json",
    countTotal: "true",
  };
  if (strategy.broader_term_query) {
    params["query.term"] = strategy.broader_term_query;
  }
  if (strategy.phases !== "ANY") {
    params["filter.phase"] = strategy.phases.join(",");
  }

  const collected: unknown[] = [];
  let next: string | undefined;
  let capped = false;
  const searchParams = new URLSearchParams(params);

  let backoff = 2000;
  const maxBackoff = 8000;

  for (;;) {
    if (next) searchParams.set("pageToken", next);
    else searchParams.delete("pageToken");
    const url = `${CT_BASE}/studies?${searchParams.toString()}`;
    const res = await fetch(url, { next: { revalidate: 0 } });

    if (res.status === 429) {
      if (backoff > maxBackoff) {
        return {
          studies: collected,
          capped,
          fetchError: { status: 429, message: "Rate limited after retries" },
        };
      }
      await sleep(backoff);
      backoff *= 2;
      continue;
    }
    backoff = 2000;

    if (!res.ok) {
      const msg = await res.text();
      return {
        studies: collected,
        capped,
        fetchError: { status: res.status, message: msg.slice(0, 500) },
      };
    }

    const data = (await res.json()) as V2StudiesResponse;
    const batch = data.studies ?? [];
    for (const s of batch) {
      collected.push(s);
      if (collected.length >= MAX_TRIALS_FETCH) {
        capped = true;
        return { studies: collected, capped };
      }
    }
    if (!data.nextPageToken || capped) break;
    next = data.nextPageToken;
  }

  return { studies: collected, capped };
}

export function buildTrialsResponse(
  strategy: SearchStrategy,
  rawStudies: unknown[],
  cappedFromFetch: boolean,
): TrialsResponse {
  const parsed: Omit<Trial, "score" | "scoreTier">[] = [];
  for (const r of rawStudies) {
    const t = parseStudy(r);
    if (t && passesPostFilters(t, strategy)) parsed.push(t);
  }

  const hints = strategy.priority_scoring_hints;
  const scored: Trial[] = parsed.map((t) => {
    const { score, scoreTier } = scoreTrial(t, hints);
    return { ...t, score, scoreTier };
  });

  scored.sort((a, b) => b.score - a.score);

  return {
    trials: scored,
    totalFetched: scored.length,
    capped: cappedFromFetch,
    zeroResults: scored.length === 0,
  };
}
