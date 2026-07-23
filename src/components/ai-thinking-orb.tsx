"use client";

import type { AiOperation } from "@/lib/types";
import { ThinkingOrb } from "@/vendor/thinking-orbs";
import type { OrbSize, OrbState } from "@/vendor/thinking-orbs";

interface AiThinkingOrbProps {
  state?: OrbState;
  size?: OrbSize;
  label: string;
  className?: string;
}

export function AiThinkingOrb({ state = "working", size = 64, label, className = "" }: AiThinkingOrbProps) {
  return <span className={`ai-thinking-orb size-${size} ${className}`.trim()}>
    <ThinkingOrb state={state} size={size} theme="light" aria-label={label}/>
  </span>;
}

export function operationOrbState(operation: AiOperation): OrbState {
  const activeStep = operation.steps.find((step) => step.state === "active");
  const signal = `${operation.kind} ${activeStep?.id || ""} ${activeStep?.label || ""}`.toLowerCase();

  if (/image_generating|render|generate.*image|processing|build speaker|live post/.test(signal)) return "shaping";
  if (/draft|writ|copy|campaign|post/.test(signal)) return "composing";
  if (/verify|check|deduplicat|consolidat|analyz|plan|validat/.test(signal)) return "solving";
  if (/research|search|source|select|load|gather|prepar|context/.test(signal)) return "searching";
  if (/read|extract|listen/.test(signal)) return "listening";
  return "working";
}

export function operationOrbWord(operation: AiOperation) {
  return ({
    working: "Finishing",
    searching: "Searching",
    solving: "Organizing",
    listening: "Reading",
    composing: "Composing",
    shaping: "Shaping"
  } as const)[operationOrbState(operation)];
}
