/**
 * Card-cover preset palette. Shared by the server action
 * (input validation) and the client CoverField (swatch rendering) so the
 * allowed set has a single source of truth.
 */
export const COVER_PALETTE = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#64748b', // slate
] as const;

export const COVER_PALETTE_SET: ReadonlySet<string> = new Set(COVER_PALETTE);
