import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { MAX_INPUT_LENGTH, POST } from "./route";
import { MAX_LENGTH } from "@/components/ChatInput";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
    createUIMessageStream: vi.fn(),
    createUIMessageStreamResponse: vi.fn(),
    convertToModelMessages: vi.fn(() => []),
    stepCountIs: vi.fn(() => () => false),
  };
});

vi.mock("@ai-sdk/openai", () => ({
  openai: { responses: vi.fn(() => "mock-model") },
}));

vi.mock("@/lib/tools", () => ({ tools: {} }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(() => ({ data: { user: null } })) },
    from: vi.fn(),
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
});

function makeRequest(messages: unknown[], chatId = "chat-1") {
  return new Request("http://localhost/api", {
    method: "POST",
    body: JSON.stringify({ messages, chatId }),
  });
}

function textMsg(text: string) {
  return { id: "m1", role: "user", parts: [{ type: "text", text }] };
}

describe("input limit", () => {
  it("route and input enforce the same character limit", () => {
    expect(MAX_INPUT_LENGTH).toBe(MAX_LENGTH);
  });
});

describe("POST /api — validation", () => {
  it("returns 400 for an empty message", async () => {
    const res = await POST(makeRequest([textMsg("")]));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Empty message");
  });

  it("returns 400 for a whitespace-only message", async () => {
    const res = await POST(makeRequest([textMsg("   ")]));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the message exceeds MAX_INPUT_LENGTH", async () => {
    const res = await POST(makeRequest([textMsg("x".repeat(10_001))]));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Message too long");
  });
});

describe("POST /api — auth guard", () => {
  it("returns 403 when the conversation is not found for an authenticated user", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(() => ({ data: null })),
    };
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: vi.fn(() => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => chain),
    } as unknown as ReturnType<typeof createClient>);

    const res = await POST(makeRequest([textMsg("hello")]));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Conversation not found");
  });
});

