// Parameters for the 3D-printed, open-front, stackable tray. All millimetres. A4 paper is just the
// default item — any width × length works (see ITEM_PRESETS), so the tray suits photos, cards,
// envelopes, etc. Pure / framework-free so the geometry builder and the viewer share one source of truth.

export type Params = {
  itemWidth: number; // width of the held item (left-right); A4 short edge by default
  itemLength: number; // length of the held item (front-back); A4 long edge by default
  clearance: number; // uniform fit gap to every enclosing wall (sides, back, and front when enclosed)
  frontOverhang: number; // how far the item sticks out the open front; 0 = fully enclosed (front gets clearance)
  wall: number; // wall thickness
  floor: number; // base/floor thickness
  depth: number; // interior height (back + side walls, above the floor)
  frontLip: number; // optional low front retaining lip above the floor (0 = fully open front)
  scoop: number; // central front grab cutout width (0 = none); dips the lip + notches the floor edge
  scoopDepth: number; // how far the scoop bites back into the floor (mm)
  cornerRadius: number; // rounded vertical outer corners
  ridgeHeight: number; // stacking ridge height (also the groove depth) — registration depth
  ridgeWidth: number; // stacking ridge thickness at its base
  wallStyle: WallStyle; // how the side + rear walls are cut (material + looks)
  wallPatternScale: number; // nominal wall cell size / pitch (mm) — independent of the margin
  wallPatternMargin: number; // solid border kept around the wall pattern (mm)
  floorStyle: WallStyle; // how the floor is cut (perforate to save filament)
  floorPatternScale: number; // nominal floor cell size / pitch (mm)
  floorPatternMargin: number; // solid border kept around the floor pattern (mm)
  stackRidge: boolean; // ridge on the wall tops + groove in the floor so trays nest when stacked
  labelRail: LabelSide; // which front corner(s) get a floor-anchored rail for the removable clip
};

// Which side(s) carry the label-clip rail. Anchored to the floor's front edge (always present),
// unlike the front wall, which is cut away on an open front.
export type LabelSide = "none" | "left" | "right" | "both";

export const LABEL_SIDES: LabelSide[] = ["none", "left", "right", "both"];

export type WallStyle =
  | "solid"
  | "louvres"
  | "voronoi"
  | "honeycomb"
  | "diamond"
  | "holes"
  | "grid";

// Runtime list of the WallStyle union, for validating persisted/untrusted values.
export const WALL_STYLES: WallStyle[] = [
  "solid",
  "louvres",
  "voronoi",
  "honeycomb",
  "diamond",
  "holes",
  "grid",
];

// One-click item sizes (width × length, mm). A4 is the default; the rest are common things you might
// want an open-front stacking tray for. Picking one only sets the two dimensions — clearance, front
// overhang and everything else stay as the user has them.
export type ItemPreset = { name: string; width: number; length: number };

export const ITEM_PRESETS: ItemPreset[] = [
  { name: "A4 paper", width: 210, length: 297 },
  { name: "US Letter", width: 216, length: 279 },
  { name: "A5", width: 148, length: 210 },
  { name: "Postcard (A6)", width: 105, length: 148 },
  { name: "4×6 photo", width: 102, length: 152 },
  { name: "Index card (3×5)", width: 76, length: 127 },
  { name: "#10 envelope", width: 105, length: 241 },
  { name: "Business card", width: 51, length: 89 },
];

export const defaults: Params = {
  itemWidth: 210,
  itemLength: 297, // A4 paper by default
  clearance: 10,
  frontOverhang: 59, // ~20% of A4 overhangs the open front (the rest, ~80%, is held)
  wall: 2.4,
  floor: 3.0, // a bit thicker so the stacking groove leaves solid floor above it
  depth: 45,
  frontLip: 0, // fully open front by default — the sheet overhangs and you grab it there
  scoop: 0, // no grab cutout by default
  scoopDepth: 30, // default bite if the scoop is enabled
  cornerRadius: 8,
  ridgeHeight: 1.6,
  ridgeWidth: 1.2,
  wallStyle: "louvres",
  wallPatternScale: 9, // ~9 mm cells
  wallPatternMargin: 7, // keeps the rim and corners solid
  floorStyle: "solid", // solid base by default; perforate it to save filament
  floorPatternScale: 9,
  floorPatternMargin: 7, // keeps the base flange / groove ring solid
  stackRidge: true,
  labelRail: "none", // off by default — pick a side to add the clip rail + export the clip
};

export type Dims = {
  innerW: number;
  innerL: number;
  outerW: number;
  outerL: number;
  H: number;
};

// Derived footprint. Width always gives the item one clearance on each side. Length: the back wall
// sits one clearance behind the item; the front depends on the overhang — at 0 the item is fully
// enclosed and the front gets its own clearance too (so `clearance` reads as the same fit gap on every
// wall), and at >0 the item overhangs the open front, where there's nothing to clear against. The
// max() guards the degenerate corner (clearance 0 + overhang == itemLength) from a non-positive length.
export function dims(p: Params): Dims {
  const innerW = p.itemWidth + 2 * p.clearance;
  const frontGap = p.frontOverhang > 0 ? 0 : p.clearance; // enclosed front earns a clearance; open doesn't
  const innerL = Math.max(p.itemLength - p.frontOverhang + p.clearance + frontGap, 8);
  const outerW = innerW + 2 * p.wall;
  const outerL = innerL + 2 * p.wall;
  const H = p.floor + p.depth;
  return { innerW, innerL, outerW, outerL, H };
}
