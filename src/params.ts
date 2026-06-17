// Parameters for the 3D-printed, open-front, stackable A4 tray. All millimetres.
// Pure / framework-free so the geometry builder and the viewer share one source of truth.

export type Params = {
  a4Width: number; // A4 short edge
  a4Length: number; // A4 long edge
  clearance: number; // gap per side wall (fits laminate pouches / pouched paper stacks)
  capture: number; // how much of the sheet's length the tray holds; the rest overhangs the open front
  wall: number; // wall thickness
  floor: number; // base/floor thickness
  depth: number; // interior height (back + side walls, above the floor)
  frontLip: number; // optional low front retaining lip above the floor (0 = fully open front)
  cornerRadius: number; // rounded vertical outer corners
  ridgeHeight: number; // stacking ridge height (also the groove depth) — registration depth
  ridgeWidth: number; // stacking ridge thickness at its base
  patternMargin: number; // solid border kept around the wall/floor pattern (mm)
  patternScale: number; // nominal pattern cell size / pitch (mm) — independent of the margin
  wallStyle: WallStyle; // how the side + rear walls are cut (material + looks)
  floorStyle: WallStyle; // how the floor is cut (perforate to save filament)
  stackRidge: boolean; // ridge on the wall tops + groove in the floor so trays nest when stacked
};

export type WallStyle =
  | "solid"
  | "louvres"
  | "voronoi"
  | "honeycomb"
  | "diamond"
  | "holes"
  | "grid";

export const defaults: Params = {
  a4Width: 210,
  a4Length: 297,
  clearance: 10,
  capture: 238, // ~80% of A4 length
  wall: 2.4,
  floor: 3.0, // a bit thicker so the stacking groove leaves solid floor above it
  depth: 45,
  frontLip: 0, // fully open front by default — the sheet overhangs and you grab it there
  cornerRadius: 8,
  ridgeHeight: 1.6,
  ridgeWidth: 1.2,
  patternMargin: 7, // keeps the rim, ridge and base flange solid
  patternScale: 9, // ~9 mm cells
  wallStyle: "louvres",
  floorStyle: "solid", // solid base by default; perforate it to save filament
  stackRidge: true,
};

export type Dims = {
  innerW: number;
  innerL: number;
  outerW: number;
  outerL: number;
  H: number;
};

// Derived footprint. The interior is a vertical prism (A4 + clearance) so paper slides in cleanly;
// only the rear gets clearance because the front is open.
export function dims(p: Params): Dims {
  const innerW = p.a4Width + 2 * p.clearance;
  const innerL = p.capture + p.clearance;
  const outerW = innerW + 2 * p.wall;
  const outerL = innerL + 2 * p.wall;
  const H = p.floor + p.depth;
  return { innerW, innerL, outerW, outerL, H };
}

// Usable horizontal print area (mm) per current Bambu Lab model, from Bambu's tech specs / wiki.
// The H2 series list the main (left) nozzle's printable area; the dual-nozzle area is a little less.
// A part can be rotated 90°, so it fits if its long/short sides clear the bed's long/short sides.
export type Printer = { name: string; w: number; d: number };
export const PRINTERS: Printer[] = [
  { name: "A1 mini", w: 180, d: 180 },
  { name: "A1", w: 256, d: 256 },
  { name: "P1P", w: 256, d: 256 },
  { name: "P1S", w: 256, d: 256 },
  { name: "X1C", w: 256, d: 256 },
  { name: "H2D", w: 325, d: 320 },
  { name: "H2S", w: 325, d: 320 },
  { name: "H2C", w: 325, d: 320 },
];
