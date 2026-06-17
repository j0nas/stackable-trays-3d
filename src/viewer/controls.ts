// Builds the numeric slider rows from a declarative table and drops each into its panel group
// (matched by data-group). Every change writes straight into the shared params object and calls
// onChange; sync() pushes params back into the inputs (used by "Reset to defaults").

import type { Params } from "../params.ts";

type NumKey = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params];
type Ctrl = { key: NumKey; label: string; min: number; max: number; step: number; group: string };

const CONTROLS: Ctrl[] = [
  // Size & fit
  { key: "capture", label: "Tray depth (footprint)", min: 150, max: 297, step: 1, group: "size" },
  { key: "clearance", label: "Clearance / side", min: 0, max: 20, step: 0.5, group: "size" },
  { key: "frontLip", label: "Front lip (0 = open)", min: 0, max: 40, step: 1, group: "size" },
  { key: "scoop", label: "Front scoop (0 = off)", min: 0, max: 120, step: 2, group: "size" },
  { key: "scoopDepth", label: "Scoop depth", min: 5, max: 100, step: 1, group: "size" },
  // Walls (structural rows, then the style select, then its pattern rows)
  { key: "depth", label: "Wall height", min: 15, max: 90, step: 1, group: "wall" },
  { key: "wall", label: "Wall thickness", min: 1.6, max: 4, step: 0.2, group: "wall" },
  { key: "cornerRadius", label: "Corner radius", min: 0, max: 20, step: 0.5, group: "wall" },
  { key: "wallPatternScale", label: "Pattern size", min: 5, max: 16, step: 0.5, group: "wallPat" },
  {
    key: "wallPatternMargin",
    label: "Pattern margin",
    min: 2,
    max: 20,
    step: 0.5,
    group: "wallPat",
  },
  // Floor
  { key: "floor", label: "Floor thickness", min: 1.6, max: 4, step: 0.2, group: "floor" },
  {
    key: "floorPatternScale",
    label: "Pattern size",
    min: 5,
    max: 16,
    step: 0.5,
    group: "floorPat",
  },
  {
    key: "floorPatternMargin",
    label: "Pattern margin",
    min: 2,
    max: 20,
    step: 0.5,
    group: "floorPat",
  },
  // Stacking
  { key: "ridgeHeight", label: "Ridge height", min: 0.6, max: 2.2, step: 0.1, group: "stack" },
  { key: "ridgeWidth", label: "Ridge width", min: 0.8, max: 3, step: 0.1, group: "stack" },
];

const tidy = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function buildControls(params: Params, onChange: () => void): { sync: () => void } {
  const syncers: Array<() => void> = [];

  for (const c of CONTROLS) {
    const row = document.createElement("div");
    row.className = "row";

    const label = document.createElement("label");
    label.textContent = c.label;

    const range = document.createElement("input");
    range.type = "range";
    range.min = String(c.min);
    range.max = String(c.max);
    range.step = String(c.step);
    range.value = String(params[c.key]);

    const num = document.createElement("input");
    num.type = "text";
    num.value = tidy(params[c.key]);

    const apply = (raw: number): void => {
      const v = Math.min(Math.max(raw, c.min), c.max);
      params[c.key] = v;
      range.value = String(v);
      num.value = tidy(v);
      onChange();
    };
    range.addEventListener("input", () => apply(Number(range.value)));
    num.addEventListener("change", () => {
      const v = Number(num.value);
      if (!Number.isNaN(v)) apply(v);
    });
    syncers.push(() => {
      range.value = String(params[c.key]);
      num.value = tidy(params[c.key]);
    });

    row.append(label, range, num);
    document.querySelector(`[data-group="${c.group}"]`)?.append(row);
  }

  return { sync: () => syncers.forEach((s) => s()) };
}
