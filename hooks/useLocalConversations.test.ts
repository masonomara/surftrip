import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalConversations } from "./useLocalConversations";
import * as storage from "@/lib/local-storage";

vi.mock("@/lib/local-storage", () => ({ loadConversations: vi.fn(() => []) }));

const mockLoad = vi.mocked(storage.loadConversations);

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockReturnValue([]);
});

const stored = [
  { id: "c1", title: "Bali trip", updatedAt: "2024-01-01", messages: [] },
];
const mapped = [{ id: "c1", title: "Bali trip", updated_at: "2024-01-01" }];

describe("useLocalConversations", () => {
  it("returns [] for authenticated users and never reads localStorage", () => {
    const { result } = renderHook(() => useLocalConversations(true));
    expect(result.current).toEqual([]);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("loads from localStorage on mount for guests", () => {
    mockLoad.mockReturnValue(stored);
    const { result } = renderHook(() => useLocalConversations(false));
    expect(result.current).toEqual(mapped);
  });

  it("re-syncs when a storage event fires", () => {
    const { result } = renderHook(() => useLocalConversations(false));
    expect(result.current).toHaveLength(0);

    mockLoad.mockReturnValue([
      { id: "c2", title: "New swell", updatedAt: "2024-02-01", messages: [] },
    ]);
    act(() => window.dispatchEvent(new StorageEvent("storage")));

    expect(result.current).toEqual([
      { id: "c2", title: "New swell", updated_at: "2024-02-01" },
    ]);
  });

  it("removes the storage listener on unmount", () => {
    const spy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useLocalConversations(false));
    unmount();
    expect(spy).toHaveBeenCalledWith("storage", expect.any(Function));
  });
});
