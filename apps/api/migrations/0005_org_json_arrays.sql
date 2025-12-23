-- Migrate org table to use JSON arrays for jurisdictions and practice_types
-- This allows orgs to have multiple jurisdictions and practice types

-- Step 1: Rename columns to plural form
ALTER TABLE `org` RENAME COLUMN `jurisdiction` TO `jurisdictions`;
--> statement-breakpoint
ALTER TABLE `org` RENAME COLUMN `practice_type` TO `practice_types`;
--> statement-breakpoint

-- Step 2: Convert existing single values to JSON arrays
-- If value exists, wrap in array: "CA" -> '["CA"]'
-- If null, set to empty array: null -> '[]'
UPDATE `org` SET `jurisdictions` =
  CASE
    WHEN `jurisdictions` IS NOT NULL AND `jurisdictions` != ''
    THEN json_array(`jurisdictions`)
    ELSE '[]'
  END;
--> statement-breakpoint

UPDATE `org` SET `practice_types` =
  CASE
    WHEN `practice_types` IS NOT NULL AND `practice_types` != ''
    THEN json_array(`practice_types`)
    ELSE '[]'
  END;
--> statement-breakpoint

-- Step 3: Set defaults for new rows (empty JSON arrays)
-- Note: SQLite doesn't support ALTER COLUMN for defaults, but new inserts
-- should explicitly provide '[]' for these fields
