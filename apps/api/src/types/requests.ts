import { z } from "zod";

export const BotActivitySchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  text: z.string().optional(),
  from: z.object({ id: z.string() }).optional(),
  recipient: z.object({ id: z.string() }).optional(),
  conversation: z.object({ id: z.string() }).optional(),
  serviceUrl: z.string().optional(),
});

export const AuditEntryInputSchema = z.object({
  user_id: z.string(),
  action: z.string(),
  object_type: z.string(),
  params: z.record(z.string(), z.unknown()),
  result: z.enum(["success", "error"]),
  error_message: z.string().optional(),
});

export type BotActivity = z.infer<typeof BotActivitySchema>;
export type AuditEntryInput = z.infer<typeof AuditEntryInputSchema>;
