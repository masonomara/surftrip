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

const mockAppendMessages = vi.mocked(storage.appendMessages);
const mockUpdateTitle = vi.mocked(storage.updateTitle);

beforeEach(() => vi.clearAllMocks());

const msg = (
  role: "user" | "assistant",
  text: string,
  id = crypto.randomUUID(),
): AppMessage =>
  ({
    id,
    role,
    parts: [{ type: "text", text }],
    createdAt: new Date(),
  }) as AppMessage;

function renderHandler(isAuthenticated: boolean, chatId = "chat-1") {
  const addEvent = vi.fn();
  const { result } = renderHook(() =>
    useOnFinishHandler({ chatId, isAuthenticated, addEvent }),
  );
  return { onFinish: result.current, addEvent };
}

describe("useOnFinishHandler — authenticated", () => {
  it("calls router.refresh() and nothing else", () => {
    const { onFinish } = renderHandler(true);
    onFinish({ messages: [msg("user", "hello"), msg("assistant", "hi")] });
    expect(mockRouter.refresh).toHaveBeenCalledOnce();
    expect(mockAppendMessages).not.toHaveBeenCalled();
    expect(mockUpdateTitle).not.toHaveBeenCalled();
  });

  it("emits a Done status event", () => {
    const { onFinish, addEvent } = renderHandler(true);
    onFinish({ messages: [] });
    expect(addEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "status", label: "Done" }),
    );
  });
});

describe("useOnFinishHandler — guest", () => {
  it("persists the last user + assistant messages to localStorage", () => {
    const { onFinish } = renderHandler(false, "chat-abc");
    const userMsg = msg("user", "Where's good swell?", "u1");
    const assistantMsg = msg("assistant", "Check Bali.", "a1");
    onFinish({ messages: [userMsg, assistantMsg] });
    expect(mockAppendMessages).toHaveBeenCalledWith("chat-abc", [
      expect.objectContaining({
        id: "u1",
        role: "user",
        content: "Where's good swell?",
      }),
      expect.objectContaining({
        id: "a1",
        role: "assistant",
        content: "Check Bali.",
      }),
    ]);
  });

  it("sets the title from the first user message", () => {
    const { onFinish } = renderHandler(false);
    onFinish({
      messages: [msg("user", "Best surf spots?"), msg("assistant", "...")],
    });
    expect(mockUpdateTitle).toHaveBeenCalledWith("chat-1", "Best surf spots?");
  });

  it("truncates titles longer than 60 characters", () => {
    const { onFinish } = renderHandler(false);
    onFinish({
      messages: [msg("user", "A".repeat(80)), msg("assistant", "...")],
    });
    expect(mockUpdateTitle).toHaveBeenCalledWith(
      "chat-1",
      "A".repeat(60) + "...",
    );
  });

  it("does not overwrite the title on subsequent exchanges", () => {
    const { onFinish } = renderHandler(false);
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

  it("dispatches a storage event so the sidebar re-syncs", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    const { onFinish } = renderHandler(false);
    onFinish({ messages: [msg("user", "hi"), msg("assistant", "hey")] });
    expect(spy).toHaveBeenCalledWith(expect.any(StorageEvent));
  });

  it("persists to localStorage before calling router.refresh()", () => {
    const order: string[] = [];
    mockAppendMessages.mockImplementation(() => {
      order.push("append");
    });
    mockRouter.refresh.mockImplementation(() => {
      order.push("refresh");
    });

    const { onFinish } = renderHandler(false);
    onFinish({ messages: [msg("user", "hi"), msg("assistant", "hey")] });

    expect(order).toEqual(["append", "refresh"]);
  });
});
