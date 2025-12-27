/**
 * Clio Schema Service
 *
 * Fetches and caches Clio custom field definitions. Custom fields are
 * firm-specific fields that extend the standard Clio data model. We need
 * these definitions so the LLM knows what custom fields are available
 * when helping users query or create records.
 */

import { createLogger } from "../lib/logger";

const log = createLogger({ component: "clio-schema" });

// Clio API base URL
const CLIO_API_BASE = "https://app.clio.com/api/v4";

/**
 * Schema version number.
 * Increment this when the custom fields format or processing changes.
 * DOs with a lower version will re-fetch their custom fields.
 */
export const CLIO_SCHEMA_VERSION = 2;

/**
 * How long custom fields are cached before being refreshed (1 hour).
 * Custom fields rarely change, so a long TTL is appropriate.
 */
export const CUSTOM_FIELDS_TTL_MS = 60 * 60 * 1000;

/**
 * Clio object types that can have custom fields.
 * We fetch custom fields for each of these types.
 */
const CUSTOM_FIELD_PARENT_TYPES = ["Matter", "Contact"] as const;

/**
 * Normalized custom field definition.
 * This is our internal representation, cleaned up from Clio's API format.
 */
export interface ClioCustomField {
  id: number;
  name: string;
  fieldType: string;
  parentType: string;
  required?: boolean;
  options?: string[];
}

/**
 * Raw response from Clio's custom fields API.
 */
interface ClioCustomFieldApiResponse {
  data: Array<{
    id: number;
    name: string;
    field_type: string;
    parent_type: string;
    required?: boolean;
    picklist_options?: Array<{ option: string }>;
  }>;
}

/**
 * Fetches custom fields for a specific object type from Clio.
 *
 * @param parentType - The object type (e.g., "Matter", "Contact")
 * @param accessToken - A valid Clio access token
 * @returns Array of custom field definitions
 */
async function fetchCustomFieldsForType(
  parentType: string,
  accessToken: string
): Promise<ClioCustomField[]> {
  const fields = "id,name,field_type,parent_type,required,picklist_options";
  const url = `${CLIO_API_BASE}/custom_fields.json?parent_type=${parentType}&deleted=false&fields=${fields}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error("Failed to fetch custom fields", {
      parentType,
      status: response.status,
      error: errorText.slice(0, 200),
    });
    return [];
  }

  const data = (await response.json()) as ClioCustomFieldApiResponse;

  if (!data.data?.length) {
    return [];
  }

  // Transform Clio's snake_case to our camelCase format
  return data.data.map((field) => ({
    id: field.id,
    name: field.name,
    fieldType: field.field_type,
    parentType: field.parent_type,
    required: field.required,
    options: field.picklist_options?.map((p) => p.option),
  }));
}

/**
 * Fetches all custom fields for all supported object types.
 *
 * Fetches in parallel for performance. If one type fails, we still
 * return fields for the types that succeeded.
 *
 * @param accessToken - A valid Clio access token
 * @returns Combined array of all custom field definitions
 */
export async function fetchAllCustomFields(
  accessToken: string
): Promise<ClioCustomField[]> {
  // Fetch all types in parallel
  const results = await Promise.allSettled(
    CUSTOM_FIELD_PARENT_TYPES.map((type) =>
      fetchCustomFieldsForType(type, accessToken)
    )
  );

  // Combine results from successful fetches
  const allFields: ClioCustomField[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      allFields.push(...result.value);
    }
  }

  log.info("Custom fields fetched", { count: allFields.length });
  return allFields;
}

/**
 * Formats custom fields for inclusion in LLM prompts.
 *
 * Groups fields by parent type and formats them in a compact,
 * human-readable format that helps the LLM understand what
 * custom fields are available.
 *
 * Example output:
 *   Matter Custom Fields: Case Type (picklist: PI|Workers Comp), Referral Source (text, required)
 *   Contact Custom Fields: Preferred Contact Method (picklist: Email|Phone)
 *
 * @param fields - Array of custom field definitions
 * @returns Formatted string for LLM context
 */
export function formatCustomFieldsForLLM(fields: ClioCustomField[]): string {
  if (!fields.length) {
    return "";
  }

  // Group fields by parent type
  const byType = new Map<string, ClioCustomField[]>();

  for (const field of fields) {
    const existing = byType.get(field.parentType) || [];
    existing.push(field);
    byType.set(field.parentType, existing);
  }

  // Format each type's fields
  const lines: string[] = [];

  for (const [parentType, typeFields] of byType) {
    const fieldDescriptions = typeFields.map((field) => {
      let description = `${field.name} (${field.fieldType}`;

      // Add options for picklist fields
      if (field.options?.length) {
        description += `: ${field.options.join("|")}`;
      }

      // Note if required
      if (field.required) {
        description += ", required";
      }

      description += ")";
      return description;
    });

    lines.push(`${parentType} Custom Fields: ${fieldDescriptions.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Determines if custom fields need to be refreshed.
 *
 * Custom fields should be refreshed if:
 * 1. We've never fetched them (version or timestamp is null)
 * 2. The schema version has been incremented (format changed)
 * 3. The cache has exceeded its TTL (1 hour)
 *
 * @param cachedVersion - The schema version when fields were last fetched
 * @param fetchedAt - Timestamp when fields were last fetched
 * @returns true if fields should be refreshed
 */
export function customFieldsNeedRefresh(
  cachedVersion: number | null,
  fetchedAt: number | null
): boolean {
  // No cached data
  if (cachedVersion === null || fetchedAt === null) {
    return true;
  }

  // Schema version has been updated
  if (cachedVersion < CLIO_SCHEMA_VERSION) {
    return true;
  }

  // Cache has expired
  const cacheAge = Date.now() - fetchedAt;
  return cacheAge > CUSTOM_FIELDS_TTL_MS;
}
