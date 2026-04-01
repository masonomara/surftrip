"use client";

import { createContext, useContext, useState } from "react";

type ProcessLogContextType = {
  steps: string[];
  addStep: (step: string) => void;
  clearSteps: () => void;
};

const ProcessLogContext = createContext<ProcessLogContextType | null>(null);

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

export function useProcessLog() {
  const ctx = useContext(ProcessLogContext);
  if (!ctx)
    throw new Error("useProcessLog must be used within ProcessLogProvider");
  return ctx;
}
