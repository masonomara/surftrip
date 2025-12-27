/**
 * Organization-related constants and helpers.
 * Used across org creation and settings pages.
 */

export const FIRM_SIZES = [
  { id: "solo", label: "Solo Practitioner", description: "Just you" },
  { id: "small", label: "Small Firm", description: "2-10 attorneys" },
  { id: "mid", label: "Mid-size Firm", description: "11-50 attorneys" },
  { id: "large", label: "Large Firm", description: "50+ attorneys" },
] as const;

export const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;

export const PRACTICE_AREAS = [
  { id: "administrative-law", label: "Administrative Law" },
  { id: "bankruptcy-law", label: "Bankruptcy Law" },
  { id: "business-and-compliance", label: "Business & Compliance" },
  { id: "civil-litigation-law", label: "Civil Litigation" },
  { id: "criminal-law", label: "Criminal Law" },
  { id: "elder-law", label: "Elder Law" },
  { id: "employment-law", label: "Employment Law" },
  { id: "estate-planning-law", label: "Estate Planning" },
  { id: "family-law", label: "Family Law" },
  { id: "general-practice", label: "General Practice" },
  { id: "government-law", label: "Government Law" },
  { id: "immigration-law", label: "Immigration Law" },
  { id: "in-house-counsel", label: "In-House Counsel" },
  { id: "intellectual-property-law", label: "Intellectual Property" },
  { id: "personal-injury-law", label: "Personal Injury" },
  { id: "real-estate-law", label: "Real Estate Law" },
] as const;

export const ORGANIZATION_TYPES = [
  { id: "law-firm", label: "Law Firm" },
  { id: "legal-clinic", label: "Legal Clinic" },
] as const;

export function getFirmSizeLabel(id: string): string {
  const firmSize = FIRM_SIZES.find((f) => f.id === id);
  return firmSize ? firmSize.label : id;
}

export function getPracticeAreaLabel(id: string): string {
  const practiceArea = PRACTICE_AREAS.find((p) => p.id === id);
  return practiceArea ? practiceArea.label : id;
}
