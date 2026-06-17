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
  wallStyle: WallStyle; // how the side + rear walls are cut (material + looks)
  wallPatternScale: number; // nominal wall cell size / pitch (mm) — independent of the margin
  wallPatternMargin: number; // solid border kept around the wall pattern (mm)
  floorStyle: WallStyle; // how the floor is cut (perforate to save filament)
  floorPatternScale: number; // nominal floor cell size / pitch (mm)
  floorPatternMargin: number; // solid border kept around the floor pattern (mm)
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
  wallStyle: "louvres",
  wallPatternScale: 9, // ~9 mm cells
  wallPatternMargin: 7, // keeps the rim and corners solid
  floorStyle: "solid", // solid base by default; perforate it to save filament
  floorPatternScale: 9,
  floorPatternMargin: 7, // keeps the base flange / groove ring solid
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
