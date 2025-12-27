CREATE TABLE `org_context_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `org_id` text NOT NULL,
  `filename` text NOT NULL,
  `mime_type` text NOT NULL,
  `size` integer NOT NULL,
  `uploaded_by` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `org_context_documents_org_idx` ON `org_context_documents` (`org_id`);
--> statement-breakpoint
CREATE INDEX `org_context_documents_uploaded_by_idx` ON `org_context_documents` (`uploaded_by`);
