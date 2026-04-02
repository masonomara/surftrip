import { isTextUIPart } from "ai";
import type { AppMessage } from "@/lib/types";

// Extract the plain text content from a message. A message can have multiple
// parts (text, tool calls, etc.); we only care about the text ones here.
export function extractText(message: AppMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("");
}
