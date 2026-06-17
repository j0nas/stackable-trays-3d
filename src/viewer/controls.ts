// Builds the numeric slider rows from a declarative table and drops each into its panel group
// (matched by data-group). Every change writes straight into the shared params object and calls
// onChange; sync() pushes params back into the inputs (used by "Reset to defaults").

import type { Params } from "../params.ts";

type NumKey = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params];
// `maxKey` makes the upper bound track another param's live value (e.g. front lip ≤ wall height)
// instead of a fixed number.
type Ctrl = {
  key: NumKey;
  label: string;
  min: number;
  max: number;
  step: number;
  group: string;
  maxKey?: NumKey;
};

const CONTROLS: Ctrl[] = [
  // Size & fit — what you hold, the fit gap, then the front treatment
  { key: "itemWidth", label: "Item width", min: 40, max: 400, step: 1, group: "size" },
  { key: "itemLength", label: "Item length", min: 40, max: 400, step: 1, group: "size" },
  { key: "clearance", label: "Clearance", min: 0, max: 20, step: 0.5, group: "size" },
  // Front overhang: how far the item sticks out the open front. 0 = fully enclosed (front earns its
  // own clearance), so it can't exceed the item length.
  {
    key: "frontOverhang",
    label: "Front overhang (0 = enclosed)",
    min: 0,
    max: 400,
    step: 1,
    group: "size",
    maxKey: "itemLength",
  },
  // Front lip is vertical (front-wall height), independent of the overhang: 0 (open top) … wall height
  // (full closed front), so cap it at the wall height.
  {
    key: "frontLip",
    label: "Front lip (0 = open top)",
    min: 0,
    max: 90,
    step: 1,
    group: "size",
    maxKey: "depth",
  },
  { key: "scoop", label: "Front scoop (0 = off)", min: 0, max: 120, step: 2, group: "size" },
  { key: "scoopDepth", label: "Scoop depth (0 = off)", min: 0, max: 100, step: 1, group: "size" },
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
  const bounders: Array<() => void> = []; // re-evaluate dynamic (maxKey) ceilings

  const hiOf = (c: Ctrl): number => (c.maxKey ? params[c.maxKey] : c.max);

  for (const c of CONTROLS) {
    const row = document.createElement("div");
    row.className = "row";

    const label = document.createElement("label");
    label.textContent = c.label;

    const range = document.createElement("input");
    range.type = "range";
    range.min = String(c.min);
    range.max = String(hiOf(c));
    range.step = String(c.step);
    range.value = String(params[c.key]);

    const num = document.createElement("input");
    num.type = "text";
    num.value = tidy(params[c.key]);

    const apply = (raw: number): void => {
      const v = Math.min(Math.max(raw, c.min), hiOf(c));
      params[c.key] = v;
      range.value = String(v);
      num.value = tidy(v);
      refreshBounds(); // changing one control (e.g. wall height) can lower another's ceiling
      onChange();
    };
    range.addEventListener("input", () => apply(Number(range.value)));
    num.addEventListener("change", () => {
      const v = Number(num.value);
      if (!Number.isNaN(v)) apply(v);
    });

    // Keep a dynamic-max slider's ceiling in step with what it depends on, clamping its value down if
    // that ceiling dropped below the current value.
    if (c.maxKey) {
      bounders.push(() => {
        const hi = hiOf(c);
        range.max = String(hi);
        if (params[c.key] > hi) {
          params[c.key] = hi;
          range.value = String(hi);
          num.value = tidy(hi);
        }
      });
    }

    syncers.push(() => {
      range.max = String(hiOf(c));
      range.value = String(params[c.key]);
      num.value = tidy(params[c.key]);
    });

    row.append(label, range, num);
    document.querySelector(`[data-group="${c.group}"]`)?.append(row);
  }

  function refreshBounds(): void {
    for (const b of bounders) b();
  }
  refreshBounds(); // apply initial dynamic ceilings

  return { sync: () => syncers.forEach((s) => s()) };
}
