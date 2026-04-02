"use client";

import { createContext, useContext, useState } from "react";
import type { ProcessStep, ProcessDataEvent } from "@/lib/types";

// ── Overview ───────────────────────────────────────────────────────────────
//
// The ToolCalls panel displays each AI tool call as it streams in.
// This context lets Chat and MessageList (deep in the tree) push steps
// and open/close the panel without prop-drilling through AppShell.

// ── Types ──────────────────────────────────────────────────────────────────

type ToolCallContextType = {
  steps: ProcessStep[];
  addEvent: (event: ProcessDataEvent) => void;
  clearSteps: () => void;
  isPanelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
};

const ToolCallContext = createContext<ToolCallContextType | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

type Props = {
  children: React.ReactNode;
};

export function ToolCallProvider({ children }: Props) {
  const [steps, setSteps] = useState<ProcessStep[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  function addEvent(event: ProcessDataEvent) {
    setSteps((prev) => {
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
          return {
            ...s,
            label:  event.label,
            status: "error" as const,
            detail: event.error,
          };
        });
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
    setIsPanelOpen(false);
  }

  return (
    <ToolCallContext.Provider value={{
      steps,
      addEvent,
      clearSteps,
      isPanelOpen,
      openPanel:  () => setIsPanelOpen(true),
      closePanel: () => setIsPanelOpen(false),
    }}>
      {children}
    </ToolCallContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useToolCall(): ToolCallContextType {
  const context = useContext(ToolCallContext);
  if (!context) {
    throw new Error("useToolCall must be used within a <ToolCallProvider>");
  }
  return context;
}
