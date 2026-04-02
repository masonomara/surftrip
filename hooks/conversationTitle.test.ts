import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOnFinishHandler } from "./useOnFinishHandler";
import * as storage from "@/lib/local-storage";
import type { AppMessage } from "@/lib/types";

const mockRouter = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
vi.mock("@/lib/local-storage", () => ({
  appendMessages: vi.fn(),
  updateTitle: vi.fn(),
}));

const mockUpdateTitle = vi.mocked(storage.updateTitle);

beforeEach(() => vi.clearAllMocks());

const msg = (
  role: "user" | "assistant",
  text: string,
): AppMessage =>
  ({
    id: crypto.randomUUID(),
    role,
    parts: [{ type: "text", text }],
    createdAt: new Date(),
  }) as AppMessage;

function renderHandler(chatId = "chat-1") {
  const { result } = renderHook(() =>
    useOnFinishHandler({ chatId, isAuthenticated: false, addEvent: vi.fn() }),
  );
  return result.current;
}

describe("conversation title", () => {
  it("truncates titles longer than 60 characters", () => {
    const onFinish = renderHandler();
    onFinish({ messages: [msg("user", "A".repeat(80)), msg("assistant", "...")] });
    expect(mockUpdateTitle).toHaveBeenCalledWith("chat-1", "A".repeat(60) + "...");
  });

  it("does not overwrite the title on subsequent exchanges", () => {
    const onFinish = renderHandler();
    onFinish({
      messages: [
        msg("user", "First"),
        msg("assistant", "First answer"),
        msg("user", "Second"),
        msg("assistant", "Second answer"),
      ],
    });
    expect(mockUpdateTitle).not.toHaveBeenCalled();
  });
});
