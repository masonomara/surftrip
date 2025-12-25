import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import type { Route } from "./+types/org.create";
import { API_URL } from "~/lib/auth-client";
import { apiFetch } from "~/lib/api";
import type { SessionResponse, OrgMembership } from "~/lib/types";
import styles from "~/styles/org-create.module.css";

// ============================================================================
// Configuration Data
// ============================================================================

const ORGANIZATION_TYPES = [
  { id: "law-firm", label: "Law Firm" },
  { id: "legal-clinic", label: "Legal Clinic" },
] as const;

const FIRM_SIZES = [
  { id: "solo", label: "Solo Practitioner", description: "Just you" },
  { id: "small", label: "Small Firm", description: "2-10 attorneys" },
  { id: "mid", label: "Mid-size Firm", description: "11-50 attorneys" },
  { id: "large", label: "Large Firm", description: "50+ attorneys" },
] as const;

const US_STATES = [
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
];

const PRACTICE_AREAS = [
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

// Step configuration
const STEP_TITLES = [
  "Organization Type",
  "Basic Information",
  "Jurisdictions",
  "Practice Areas",
];

const STEP_SUBTITLES = [
  "What type of organization are you creating?",
  "Tell us about your firm",
  "Select the states where you practice",
  "Select your areas of practice",
];

// ============================================================================
// Types
// ============================================================================

type Step = 1 | 2 | 3 | 4;

interface FormData {
  orgType: string;
  name: string;
  firmSize: string;
  jurisdictions: string[];
  practiceAreas: string[];
}

// ============================================================================
// Loader
// ============================================================================

/**
 * Server-side loader that ensures user is authenticated and doesn't already have an org.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const cookie = request.headers.get("cookie") || "";

  // Check if user is authenticated
  const sessionResponse = await apiFetch(
    context,
    "/api/auth/get-session",
    cookie
  );

  if (!sessionResponse.ok) {
    throw redirect("/login");
  }

  const sessionData = (await sessionResponse.json()) as SessionResponse | null;

  if (!sessionData?.user) {
    throw redirect("/login");
  }

  // Check if user already has an org
  const orgResponse = await apiFetch(context, "/api/user/org", cookie);

  if (orgResponse.ok) {
    const orgData = (await orgResponse.json()) as OrgMembership | null;
    if (orgData?.org) {
      // User already has an org, redirect to dashboard
      throw redirect("/dashboard");
    }
  }

  return { user: sessionData.user };
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Multi-step organization creation wizard.
 */
export default function OrgCreatePage(_props: Route.ComponentProps) {
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    orgType: "",
    name: "",
    firmSize: "",
    jurisdictions: [],
    practiceAreas: [],
  });

  /**
   * Updates a single field in the form data.
   */
  function updateField<K extends keyof FormData>(field: K, value: FormData[K]) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Toggles an item in an array field (jurisdictions or practiceAreas).
   */
  function toggleArrayItem(
    field: "jurisdictions" | "practiceAreas",
    itemId: string
  ) {
    setFormData((prev) => {
      const currentItems = prev[field];
      const isSelected = currentItems.includes(itemId);

      return {
        ...prev,
        [field]: isSelected
          ? currentItems.filter((id) => id !== itemId)
          : [...currentItems, itemId],
      };
    });
  }

  /**
   * Checks if the current step is complete and user can proceed.
   */
  function canProceed(): boolean {
    switch (currentStep) {
      case 1:
        return formData.orgType !== "";
      case 2:
        return formData.name.trim() !== "" && formData.firmSize !== "";
      case 3:
        return formData.jurisdictions.length > 0;
      case 4:
        return formData.practiceAreas.length > 0;
      default:
        return false;
    }
  }

  /**
   * Moves to the next step.
   */
  function goToNextStep() {
    setCurrentStep((prev) => (prev + 1) as Step);
  }

  /**
   * Moves to the previous step.
   */
  function goToPreviousStep() {
    setCurrentStep((prev) => (prev - 1) as Step);
  }

  /**
   * Submits the form to create the organization.
   */
  async function handleSubmit() {
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/org`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: formData.name.trim(),
          firmSize: formData.firmSize,
          jurisdictions: formData.jurisdictions,
          practiceTypes: formData.practiceAreas,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to create organization");
      }

      navigate("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* Progress Indicator */}
        <ProgressIndicator currentStep={currentStep} />

        {/* Step Header */}
        <h1 className={styles.title}>{STEP_TITLES[currentStep - 1]}</h1>
        <p className={styles.subtitle}>{STEP_SUBTITLES[currentStep - 1]}</p>

        {/* Error Message */}
        {errorMessage && <div className={styles.errorBox}>{errorMessage}</div>}

        {/* Step Content */}
        {currentStep === 1 && (
          <OrgTypeStep
            selectedType={formData.orgType}
            onSelect={(type) => updateField("orgType", type)}
          />
        )}

        {currentStep === 2 && (
          <BasicInfoStep
            name={formData.name}
            firmSize={formData.firmSize}
            onNameChange={(name) => updateField("name", name)}
            onFirmSizeChange={(size) => updateField("firmSize", size)}
          />
        )}

        {currentStep === 3 && (
          <JurisdictionsStep
            selectedJurisdictions={formData.jurisdictions}
            onToggle={(jurisdiction) =>
              toggleArrayItem("jurisdictions", jurisdiction)
            }
          />
        )}

        {currentStep === 4 && (
          <PracticeAreasStep
            selectedAreas={formData.practiceAreas}
            onToggle={(area) => toggleArrayItem("practiceAreas", area)}
          />
        )}

        {/* Navigation Buttons */}
        <div className={styles.buttons}>
          {currentStep > 1 && (
            <button
              type="button"
              className={styles.backButton}
              onClick={goToPreviousStep}
            >
              Back
            </button>
          )}

          {currentStep < 4 ? (
            <button
              type="button"
              className={styles.continueButton}
              onClick={goToNextStep}
              disabled={!canProceed()}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              className={styles.submitButton}
              onClick={handleSubmit}
              disabled={!canProceed() || isSubmitting}
            >
              {isSubmitting ? "Creating..." : "Create Organization"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Progress indicator showing current step.
 */
function ProgressIndicator({ currentStep }: { currentStep: Step }) {
  return (
    <div className={styles.progress}>
      {[1, 2, 3, 4].map((stepNumber) => {
        const isActive = stepNumber === currentStep;
        const isCompleted = stepNumber < currentStep;

        let className = styles.progressStep;
        if (isActive) className += ` ${styles.active}`;
        if (isCompleted) className += ` ${styles.completed}`;

        return <div key={stepNumber} className={className} />;
      })}
    </div>
  );
}

/**
 * Step 1: Organization type selection.
 */
function OrgTypeStep({
  selectedType,
  onSelect,
}: {
  selectedType: string;
  onSelect: (type: string) => void;
}) {
  return (
    <div className={styles.optionGrid}>
      {ORGANIZATION_TYPES.map((type) => {
        const isSelected = selectedType === type.id;
        const className = isSelected
          ? `${styles.optionCard} ${styles.selected}`
          : styles.optionCard;

        return (
          <button
            key={type.id}
            type="button"
            className={className}
            onClick={() => onSelect(type.id)}
          >
            {type.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Step 2: Basic organization information.
 */
function BasicInfoStep({
  name,
  firmSize,
  onNameChange,
  onFirmSizeChange,
}: {
  name: string;
  firmSize: string;
  onNameChange: (name: string) => void;
  onFirmSizeChange: (size: string) => void;
}) {
  return (
    <div className={styles.formFields}>
      {/* Organization Name */}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="orgName">
          Organization Name
        </label>
        <input
          id="orgName"
          type="text"
          className={styles.input}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Smith & Associates"
        />
      </div>

      {/* Firm Size */}
      <div className={styles.fieldGroup}>
        <label className={styles.label}>Firm Size</label>
        <div className={styles.sizeGrid}>
          {FIRM_SIZES.map((size) => {
            const isSelected = firmSize === size.id;
            const className = isSelected
              ? `${styles.sizeCard} ${styles.selected}`
              : styles.sizeCard;

            return (
              <button
                key={size.id}
                type="button"
                className={className}
                onClick={() => onFirmSizeChange(size.id)}
              >
                <span className={styles.sizeLabel}>{size.label}</span>
                <span className={styles.sizeDescription}>
                  {size.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Step 3: Jurisdiction selection.
 */
function JurisdictionsStep({
  selectedJurisdictions,
  onToggle,
}: {
  selectedJurisdictions: string[];
  onToggle: (jurisdiction: string) => void;
}) {
  return (
    <div className={styles.checkboxGrid}>
      {US_STATES.map((state) => {
        const isSelected = selectedJurisdictions.includes(state);
        const className = isSelected
          ? `${styles.checkboxItem} ${styles.selected}`
          : styles.checkboxItem;

        return (
          <label key={state} className={className}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggle(state)}
              className={styles.checkboxInput}
            />
            <span className={styles.checkboxLabel}>{state}</span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Step 4: Practice areas selection.
 */
function PracticeAreasStep({
  selectedAreas,
  onToggle,
}: {
  selectedAreas: string[];
  onToggle: (areaId: string) => void;
}) {
  return (
    <div className={styles.practiceGrid}>
      {PRACTICE_AREAS.map((area) => {
        const isSelected = selectedAreas.includes(area.id);
        const className = isSelected
          ? `${styles.practiceItem} ${styles.selected}`
          : styles.practiceItem;

        return (
          <label key={area.id} className={className}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggle(area.id)}
              className={styles.checkboxInput}
            />
            <span className={styles.practiceLabel}>{area.label}</span>
          </label>
        );
      })}
    </div>
  );
}
