"use client";

import { createContext, useContext, useState } from "react";
import type { ProcessStep, ProcessDataEvent } from "@/lib/types";

// ── Overview ───────────────────────────────────────────────────────────────
//
// The ToolCalls panel displays each AI tool call as it streams in.
// This context lets ChatView (deep in the tree) push steps to ToolCalls
// (a sibling, not a descendant) without prop-drilling through AppShell.

// ── Types ──────────────────────────────────────────────────────────────────

type ToolCallsContextType = {
  steps: ProcessStep[];
  addEvent: (event: ProcessDataEvent) => void;
  clearSteps: () => void;
};

const ToolCallsContext = createContext<ToolCallsContextType | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

type Props = {
  children: React.ReactNode;
};

export function ToolCallsProvider({ children }: Props) {
  const [steps, setSteps] = useState<ProcessStep[]>([]);

  function addEvent(event: ProcessDataEvent) {
    setSteps((prev) => {
      if (event.kind === "tool-done") {
        return prev.map((s) => {
          if (s.id !== event.id || s.kind !== "tool") return s;
          return {
            ...s,
            label:   event.label,
            status:  "done" as const,
            detail:  event.detail,
            params:  event.params,
            apiUrl:  event.apiUrl,
            sources: event.sources,
          };
        });
      }

      if (event.kind === "tool-error") {
        return prev.map((s) => {
          if (s.id !== event.id || s.kind !== "tool") return s;
          return { ...s, label: event.label, status: "error" as const };
        });
      }

      if (event.kind === "tool-start") {
        const newStep: ProcessStep = {
          id: event.id,
          kind: "tool",
          toolName: event.toolName,
          label: event.label,
          status: "active",
        };
        return [...prev, newStep];
      }

      // kind === "status"
      const newStep: ProcessStep = {
        id: event.id,
        kind: "status",
        label: event.label,
        status: event.label === "Done" ? "done" : "active",
      };
      return [...prev, newStep];
    });
  }

  function clearSteps() {
    setSteps([]);
  }

  return (
    <ToolCallsContext.Provider value={{ steps, addEvent, clearSteps }}>
      {children}
    </ToolCallsContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useToolCalls(): ToolCallsContextType {
  const context = useContext(ToolCallsContext);
  if (!context) {
    throw new Error("useToolCalls must be used within a <ToolCallsProvider>");
  }
  return context;
}
