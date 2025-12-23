// =============================================================================
// Clio Schema Service
// =============================================================================
//
// Fetches and caches Clio object schemas for LLM context injection.
// The LLM uses these schemas to understand what fields are available
// when building Clio API queries.

const CLIO_API_BASE = "https://app.clio.com/api/v4";

/**
 * Increment this version when schemas need to be re-fetched.
 * Used to invalidate cached schemas when our understanding of
 * Clio's API changes.
 */
export const CLIO_SCHEMA_VERSION = 1;

/**
 * Core Clio objects that users commonly query and modify
 */
const CORE_OBJECTS = [
  "matters",
  "contacts",
  "tasks",
  "calendar_entries",
  "time_entries",
  "documents",
];

/**
 * Reference objects that are read-only (used for lookups)
 */
const READ_ONLY_OBJECTS = ["practice_areas", "activity_descriptions", "users"];

// =============================================================================
// Types
// =============================================================================

export interface ClioSchemaField {
  name: string;
  type: string;
  required?: boolean;
  readOnly?: boolean;
  enum?: string[];
  relationship?: boolean;
}

export interface ClioSchema {
  objectType: string;
  fields: ClioSchemaField[];
  customFields?: Array<{
    name: string;
    type: string;
    fieldType: string;
  }>;
}

interface ClioSchemaApiResponse {
  schema?: {
    type: string;
    fields: Array<{
      name: string;
      type: string;
      required?: boolean;
      read_only?: boolean;
      enum?: string[];
      relationship?: boolean;
    }>;
  };
}

// =============================================================================
// Schema Fetching
// =============================================================================

/**
 * Fetch the schema for a single Clio object type.
 *
 * @param objectType - The Clio object type (e.g., "matters", "contacts")
 * @param accessToken - Valid Clio access token
 * @returns The schema, or null if fetch failed
 */
export async function fetchObjectSchema(
  objectType: string,
  accessToken: string
): Promise<ClioSchema | null> {
  const url = `${CLIO_API_BASE}/${objectType}.json?fields=schema`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.error(`Failed to fetch schema for ${objectType}:`, response.status);
    return null;
  }

  const data = (await response.json()) as ClioSchemaApiResponse;

  if (!data.schema) {
    return null;
  }

  // Transform the API response to our schema format
  const fields: ClioSchemaField[] = data.schema.fields.map((field) => ({
    name: field.name,
    type: field.type,
    required: field.required,
    readOnly: field.read_only,
    enum: field.enum,
    relationship: field.relationship,
  }));

  return {
    objectType: data.schema.type,
    fields,
  };
}

/**
 * Fetch schemas for all known Clio object types.
 *
 * Fetches in parallel for performance. Individual failures are logged
 * but don't prevent other schemas from being returned.
 *
 * @param accessToken - Valid Clio access token
 * @returns Map of object type to schema
 */
export async function fetchAllSchemas(
  accessToken: string
): Promise<Map<string, ClioSchema>> {
  const allObjectTypes = [...CORE_OBJECTS, ...READ_ONLY_OBJECTS];
  const schemas = new Map<string, ClioSchema>();

  // Fetch all schemas in parallel
  const fetchPromises = allObjectTypes.map((objectType) =>
    fetchObjectSchema(objectType, accessToken)
  );

  const results = await Promise.allSettled(fetchPromises);

  // Collect successful results
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const objectType = allObjectTypes[i];

    if (result.status === "fulfilled" && result.value) {
      schemas.set(objectType, result.value);
    }
  }

  return schemas;
}

// =============================================================================
// Schema Formatting (for LLM context)
// =============================================================================

/**
 * Format schemas into a compact string for LLM context.
 *
 * Example output:
 * ```
 * Matter: { id: integer (read-only), display_number: string, ... }
 * Contact: { id: integer (read-only), name: string (required), ... }
 * ```
 */
export function formatSchemasForLLM(schemas: Map<string, ClioSchema>): string {
  const formattedLines: string[] = [];

  for (const schema of schemas.values()) {
    const fieldDescriptions = schema.fields.map((field) => {
      let description = `${field.name}: ${field.type}`;

      if (field.required) {
        description += " (required)";
      }
      if (field.readOnly) {
        description += " (read-only)";
      }
      if (field.enum) {
        description += ` [${field.enum.join("|")}]`;
      }

      return description;
    });

    const fieldsString = fieldDescriptions.join(", ");
    formattedLines.push(`${schema.objectType}: { ${fieldsString} }`);
  }

  return formattedLines.join("\n");
}

// =============================================================================
// Schema Versioning
// =============================================================================

/**
 * Check if cached schemas are outdated and need to be refreshed.
 *
 * @param cachedVersion - The version of currently cached schemas (null if none)
 * @returns true if schemas should be re-fetched
 */
export function schemaNeedsRefresh(cachedVersion: number | null): boolean {
  // No cached version - definitely need to fetch
  if (cachedVersion === null) {
    return true;
  }

  // Cached version is older than current
  return cachedVersion < CLIO_SCHEMA_VERSION;
}
