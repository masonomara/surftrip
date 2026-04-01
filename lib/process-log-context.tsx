"use client";

import { createContext, useContext, useState } from "react";
import type { ProcessStep, ProcessDataEvent } from "@/lib/types";

// ── Overview ───────────────────────────────────────────────────────────────
//
// The ProcessLog panel displays the AI's reasoning steps as they stream in.
// This context lets ChatView (deep in the tree) push steps to ProcessLog
// (a sibling, not a descendant) without prop-drilling through AppShell.

// ── Types ──────────────────────────────────────────────────────────────────

type ProcessLogContextType = {
  steps: ProcessStep[];
  addEvent: (event: ProcessDataEvent) => void;
  clearSteps: () => void;
};

const ProcessLogContext = createContext<ProcessLogContextType | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

type Props = {
  children: React.ReactNode;
};

export function ProcessLogProvider({ children }: Props) {
  const [steps, setSteps] = useState<ProcessStep[]>([]);

  function addEvent(event: ProcessDataEvent) {
    setSteps((prev) => {
      if (event.kind === "tool-done") {
        return prev.map((s) => {
          if (s.id !== event.id || s.kind !== "tool") return s;
          return {
            ...s,
            label: event.label,
            status: "done" as const,
            detail: event.detail,
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
    <ProcessLogContext.Provider value={{ steps, addEvent, clearSteps }}>
      {children}
    </ProcessLogContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useProcessLog(): ProcessLogContextType {
  const context = useContext(ProcessLogContext);
  if (!context) {
    throw new Error("useProcessLog must be used within a <ProcessLogProvider>");
  }
  return context;
}
