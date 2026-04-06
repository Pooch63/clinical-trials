/** Fields for ClinicalTrials.gov API v2 `fields` param (PrimaryPurpose → DesignPrimaryPurpose). */
export const CONSTANT_FIELDS: string[] = [
  "NCTId",
  "BriefTitle",
  "OfficialTitle",
  "Condition",
  "Keyword",
  "StartDate",
  "PrimaryCompletionDate",
  "StudyFirstPostDate",
  "LastUpdatePostDate",
  "OverallStatus",
  "Phase",
  "StudyType",
  "InterventionType",
  "InterventionName",
  "DesignPrimaryPurpose",
  "EnrollmentCount",
  "EligibilityCriteria",
  "CentralContactName",
  "CentralContactEMail",
  "CentralContactPhone",
  "OverallOfficialName",
  "OverallOfficialAffiliation",
  "LocationFacility",
  "LocationCity",
  "LocationState",
  "LocationCountry",
  "LeadSponsorName",
  "LeadSponsorClass",
];

export const CT_BASE = "https://clinicaltrials.gov/api/v2";

export const MAX_TRIALS_FETCH = 5000;
