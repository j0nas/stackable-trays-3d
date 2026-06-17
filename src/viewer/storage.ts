// Persist the tray parameters in the browser so a reload restores the last configuration.
// Browser-only (uses localStorage); kept out of main.ts so the storage concern — the key, the JSON
// round-trip, and the defensive merge — lives on its own.
//
// The merge is deliberately paranoid: a stored blob is untrusted (it may be stale from an older
// schema, or hand-edited). We only take a key that exists in `defaults` AND whose stored value has
// the same primitive type as the default, so nothing can inject extra keys or wrong types into
// Params; the two style unions are then clamped to a known value. Anything off keeps the default.

import { type Params, WALL_STYLES } from "../params.ts";

const KEY = "a4-trays:params:v1"; // bump the suffix if Params ever changes incompatibly

// Build a clean Params from an untrusted parsed value, key by key against `defaults`.
export function sanitizeParams(defaults: Params, raw: unknown): Params {
  const out: Params = { ...defaults };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const k of Object.keys(defaults) as (keyof Params)[]) {
    const stored = src[k];
    // typeof guards number, boolean and string keys; JSON turns NaN/Infinity into null, so those are
    // rejected here too and keep the default.
    if (typeof stored === typeof defaults[k]) (out[k] as unknown) = stored;
  }
  // wallStyle/floorStyle are unions, not any string — clamp a junk value back to the default.
  if (!WALL_STYLES.includes(out.wallStyle)) out.wallStyle = defaults.wallStyle;
  if (!WALL_STYLES.includes(out.floorStyle)) out.floorStyle = defaults.floorStyle;
  return out;
}

export function loadParams(defaults: Params): Params {
  try {
    const txt = localStorage.getItem(KEY);
    return txt ? sanitizeParams(defaults, JSON.parse(txt)) : { ...defaults };
  } catch {
    return { ...defaults }; // storage disabled (private mode) or bad JSON -> defaults
  }
}

export function saveParams(p: Params): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage full or disabled -> non-fatal, just don't persist this change
  }
}

export function clearParams(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
