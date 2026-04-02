import { describe, it, expect, beforeEach } from "vitest";
import {
  loadConversations,
  loadConversation,
  createConversation,
  appendMessages,
  updateTitle,
  deleteConversation,
  clearConversationMessages,
} from "./local-storage";

beforeEach(() => localStorage.clear());

const msg = (id: string, content: string) => ({
  id,
  role: "user" as const,
  content,
  createdAt: new Date().toISOString(),
});

describe("loadConversations", () => {
  it("returns [] when storage is empty", () => {
    expect(loadConversations()).toEqual([]);
  });

  it("returns [] when storage contains invalid JSON", () => {
    localStorage.setItem("surftrip_conversations", "not-json");
    expect(loadConversations()).toEqual([]);
  });
});

describe("createConversation", () => {
  it("persists a new conversation", () => {
    createConversation("abc", "My trip");
    const conv = loadConversation("abc");
    expect(conv).toMatchObject({ id: "abc", title: "My trip", messages: [] });
  });

  it("prepends so the newest appears first", () => {
    createConversation("first", "First");
    createConversation("second", "Second");
    expect(loadConversations().map((c) => c.id)).toEqual(["second", "first"]);
  });
});

describe("appendMessages", () => {
  it("adds messages to an existing conversation", () => {
    createConversation("conv1", "Test");
    appendMessages("conv1", [msg("m1", "hi"), msg("m2", "hello")]);
    const messages = loadConversation("conv1")!.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("hi");
    expect(messages[1].content).toBe("hello");
  });

  it("does nothing for an unknown id", () => {
    expect(() => appendMessages("ghost", [msg("m1", "hi")])).not.toThrow();
  });
});

describe("updateTitle", () => {
  it("changes the title", () => {
    createConversation("conv1", "Old");
    updateTitle("conv1", "New");
    expect(loadConversation("conv1")!.title).toBe("New");
  });

  it("does nothing for an unknown id", () => {
    expect(() => updateTitle("ghost", "title")).not.toThrow();
  });
});

describe("deleteConversation", () => {
  it("removes the target conversation", () => {
    createConversation("conv1", "Test");
    deleteConversation("conv1");
    expect(loadConversation("conv1")).toBeNull();
  });

  it("leaves other conversations intact", () => {
    createConversation("keep", "Keep me");
    createConversation("remove", "Remove me");
    deleteConversation("remove");
    expect(loadConversation("keep")).not.toBeNull();
    expect(loadConversation("remove")).toBeNull();
  });
});

describe("clearConversationMessages", () => {
  it("empties messages while keeping the conversation", () => {
    createConversation("conv1", "Test");
    appendMessages("conv1", [msg("m1", "hi")]);
    clearConversationMessages("conv1");
    const conv = loadConversation("conv1");
    expect(conv).not.toBeNull();
    expect(conv!.messages).toEqual([]);
  });
});
