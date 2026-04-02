import { describe, it, expect } from "vitest";
import { extractText } from "./utils";
import type { AppMessage } from "./types";

const msg = (parts: AppMessage["parts"]): AppMessage =>
  ({ id: "1", role: "user", parts, createdAt: new Date() }) as AppMessage;

describe("extractText", () => {
  it("returns text from a single text part", () => {
    expect(extractText(msg([{ type: "text", text: "hello" }]))).toBe("hello");
  });

  it("joins multiple text parts with no separator", () => {
    expect(
      extractText(
        msg([
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
        ]),
      ),
    ).toBe("hello world");
  });

  it("ignores non-text parts", () => {
    expect(
      extractText(
        msg([
          { type: "text", text: "before" },
          { type: "tool-invocation" } as unknown as AppMessage["parts"][number],
          { type: "text", text: "after" },
        ]),
      ),
    ).toBe("beforeafter");
  });

  it("returns empty string when there are no text parts", () => {
    expect(extractText(msg([]))).toBe("");
  });
});
