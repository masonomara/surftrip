"use client";

import { createContext, useContext, useState } from "react";

// The ProcessLog panel displays the AI's reasoning steps as they stream in.
// This context lets ChatView (deep in the tree) push steps to ProcessLog
// (a sibling, not a descendant) without prop-drilling through AppShell.

// ── Types ──────────────────────────────────────────────────────────────────

type ProcessLogContextType = {
  steps: string[];
  addStep: (step: string) => void;
  clearSteps: () => void;
};

const ProcessLogContext = createContext<ProcessLogContextType | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

type Props = {
  children: React.ReactNode;
};

export function ProcessLogProvider({ children }: Props) {
  const [steps, setSteps] = useState<string[]>([]);

  function addStep(step: string) {
    setSteps((prev) => [...prev, step]);
  }

  function clearSteps() {
    setSteps([]);
  }

  return (
    <ProcessLogContext.Provider value={{ steps, addStep, clearSteps }}>
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
