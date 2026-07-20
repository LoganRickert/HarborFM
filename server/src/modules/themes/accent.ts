/** Accent palette for Liquid theme context (mirrors web feedAccent). */

export type AccentColors = {
  id: string;
  color: string;
  dim: string;
  glow: string;
};

const PALETTE: Record<string, Omit<AccentColors, "id">> = {
  green: {
    color: "#00d4aa",
    dim: "#00a884",
    glow: "rgba(0, 212, 170, 0.25)",
  },
  cyan: {
    color: "#22d3ee",
    dim: "#0891b2",
    glow: "rgba(34, 211, 238, 0.25)",
  },
  blue: {
    color: "#3b82f6",
    dim: "#2563eb",
    glow: "rgba(59, 130, 246, 0.25)",
  },
  indigo: {
    color: "#6366f1",
    dim: "#4f46e5",
    glow: "rgba(99, 102, 241, 0.25)",
  },
  violet: {
    color: "#a855f7",
    dim: "#9333ea",
    glow: "rgba(168, 85, 247, 0.25)",
  },
  pink: {
    color: "#ec4899",
    dim: "#db2777",
    glow: "rgba(236, 72, 153, 0.25)",
  },
  red: {
    color: "#ef4444",
    dim: "#dc2626",
    glow: "rgba(239, 68, 68, 0.25)",
  },
  orange: {
    color: "#f97316",
    dim: "#ea580c",
    glow: "rgba(249, 115, 22, 0.25)",
  },
  amber: {
    color: "#f59e0b",
    dim: "#d97706",
    glow: "rgba(245, 158, 11, 0.25)",
  },
  lime: {
    color: "#84cc16",
    dim: "#65a30d",
    glow: "rgba(132, 204, 22, 0.25)",
  },
};

export function resolveAccent(accentId: string | null | undefined): AccentColors {
  const id = (accentId?.trim() || "green").toLowerCase();
  const colors = PALETTE[id] ?? PALETTE.green!;
  return { id: PALETTE[id] ? id : "green", ...colors };
}
