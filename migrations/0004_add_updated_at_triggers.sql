-- Auto-update updated_at timestamps on modification
-- Better Auth tables (user, session, account, verification) are managed by the library
-- WHEN clause prevents infinite recursion by only firing when updated_at wasn't explicitly changed

-- Trigger for org table
CREATE TRIGGER `org_updated_at`
AFTER UPDATE ON `org`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
  UPDATE `org` SET `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
  WHERE `id` = OLD.`id`;
END;
--> statement-breakpoint

-- Trigger for subscriptions table
CREATE TRIGGER `subscriptions_updated_at`
AFTER UPDATE ON `subscriptions`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
  UPDATE `subscriptions` SET `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
  WHERE `id` = OLD.`id`;
END;
