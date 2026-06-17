// Pure geometry builder: Params -> a single watertight THREE.BufferGeometry, ready for both the
// live preview and STL export. Modelled with Z up and the base on z = 0 (millimetres), which is
// what slicers expect, so the exported STL drops onto the Bambu plate at true size.
//
// Three.js is a render-mesh library, not a solid modeller, so the boolean solid operations run
// through manifold-3d (see csg.ts), which guarantees watertight 2-manifold output suitable for
// printing. Everything is designed to print base-down with NO supports: walls are vertical, every
// opening's top only bridges a short span, and the stacking ridge/groove are tapered so they
// self-support.

import { type BufferGeometry, Path, Shape } from "three";
import { Delaunay } from "d3-delaunay";
import { type Mat, type Scope, type Solid, scope } from "./csg.ts";
import { RAIL } from "./label.ts";
import { dims, type Params, type WallStyle } from "./params.ts";

// Trace a rounded rectangle (centred on the origin, XY plane) onto a Path or Shape. With
// `squareFront`, the two front corners (−Y, the open-front edge) are left square: with no front wall
// there's nothing to round into, so a rounded corner just makes the side walls curve inward. Square
// them and the walls run straight to the front. Same footprint either way — only the corner shape
// changes, so dimensions and bed fit are unaffected.
function roundedRectInto<T extends Path>(
  path: T,
  w: number,
  l: number,
  radius: number,
  squareFront = false,
): T {
  const hw = w / 2;
  const hl = l / 2;
  const r = Math.max(Math.min(radius, hw - 0.01, hl - 0.01), 0);
  const fr = squareFront ? 0 : r; // front (−Y) corner radius
  path.moveTo(-hw + fr, -hl);
  path.lineTo(hw - fr, -hl);
  if (fr > 0) path.absarc(hw - fr, -hl + fr, fr, -Math.PI / 2, 0, false);
  path.lineTo(hw, hl - r);
  path.absarc(hw - r, hl - r, r, 0, Math.PI / 2, false);
  path.lineTo(-hw + r, hl);
  path.absarc(-hw + r, hl - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(-hw, -hl + fr);
  if (fr > 0) path.absarc(-hw + fr, -hl + fr, fr, Math.PI, Math.PI * 1.5, false);
  path.closePath();
  return path;
}

function roundedRect(w: number, l: number, r: number, squareFront = false): Shape {
  return roundedRectInto(new Shape(), w, l, r, squareFront);
}

// Where the label-clip rails sit, so the viewer can drop a clip preview straight onto one without
// re-deriving the geometry. Returns null when the wall is too shallow for a useful rail.
export function labelRailPlacement(
  p: Params,
): { railLen: number; z: number; y: number; xRight: number } | null {
  const { outerW, outerL, H } = dims(p);
  const railLen = Math.min(RAIL.len, p.depth - 6);
  if (railLen <= 8) return null;
  const railTop = H - 3; // kept below the wall top so a stacked tray clears the rail + clip
  return {
    railLen,
    z: railTop - railLen / 2,
    y: -outerL / 2 - RAIL.stemY - RAIL.headT / 2, // head centre — the clip's local origin aligns here
    xRight: outerW / 2 - p.wall / 2, // side-wall centreline
  };
}

function rectShape(cx: number, cy: number, w: number, h: number): Shape {
  const s = new Shape();
  s.moveTo(cx - w / 2, cy - h / 2);
  s.lineTo(cx + w / 2, cy - h / 2);
  s.lineTo(cx + w / 2, cy + h / 2);
  s.lineTo(cx - w / 2, cy + h / 2);
  s.closePath();
  return s;
}

// A rounded-rectangular ring profile (outer rounded rect minus an inner one) as a 2D Shape, ready to
// extrude. Used for the tapered stacking ridge/groove slices.
function ringShape(
  oW: number,
  oL: number,
  oR: number,
  iW: number,
  iL: number,
  iR: number,
  squareFront = false,
): Shape {
  const s = roundedRect(oW, oL, oR, squareFront);
  s.holes.push(roundedRectInto(new Path(), iW, iL, iR, squareFront));
  return s;
}

// A loop with a tapered (chamfered) cross-section: a stack of thin ring slices that shrink from
// `wBottom` (full thickness at zBottom) to `wTop`, unioned into one manifold solid. Used for the
// self-registering stacking ridge (peak up) and the funnel groove (wide mouth) — both print without
// support. Slices overlap slightly so the union is watertight.
function taperedRing(
  s: Scope,
  cW: number,
  cL: number,
  cr: number,
  wBottom: number,
  wTop: number,
  zBottom: number,
  height: number,
  slices: number,
  squareFront = false,
): Solid {
  const parts: Solid[] = [];
  const dh = height / slices;
  for (let i = 0; i < slices; i++) {
    const f = (i + 0.5) / slices;
    const w = wBottom + (wTop - wBottom) * f;
    const sh = ringShape(
      cW + w,
      cL + w,
      Math.max(cr + w / 2, 0.5),
      cW - w,
      cL - w,
      Math.max(cr - w / 2, 0.3),
      squareFront,
    );
    parts.push(s.move(s.extrude(sh, dh + 0.08), 0, 0, zBottom + i * dh - 0.04));
  }
  return s.union(parts);
}

// --- wall patterns: 2D shapes in local (u = along wall, v = vertical) coordinates -------------

function louvreShapes(wLen: number, hLen: number, size: number): Shape[] {
  const slotW = size;
  const gap = size * 0.85;
  const n = Math.floor((wLen + gap) / (slotW + gap));
  if (n < 1) return [];
  const used = n * slotW + (n - 1) * gap;
  return Array.from({ length: n }, (_, i) =>
    rectShape(-used / 2 + slotW / 2 + i * (slotW + gap), 0, slotW, hLen),
  );
}

// Deterministic PRNG so the voronoi pattern is stable across rebuilds (no flicker on slider drag).
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Keep the part of a convex ring on the inner side of a line through (px,py) with inward normal n.
function clipHalfPlane(
  poly: [number, number][],
  px: number,
  py: number,
  nx: number,
  ny: number,
): [number, number][] {
  const out: [number, number][] = [];
  const side = (p: [number, number]): number => (p[0] - px) * nx + (p[1] - py) * ny;
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prv = poly[(i + poly.length - 1) % poly.length];
    const dc = side(cur);
    const dp = side(prv);
    if (dp >= 0 !== dc >= 0) {
      const t = dp / (dp - dc);
      out.push([prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t]);
    }
    if (dc >= 0) out.push(cur);
  }
  return out;
}

// Erode a convex polygon inward by a fixed distance `d` (half the strut width), by intersecting the
// inward-shifted half-plane of every edge. Returns [] if the cell is too small to survive — voronoi
// cells are always convex, so this is exact. Using a FIXED inset (not a ratio) is what makes the
// open area, and thus the filament estimate, respond to cell size like the lattice patterns do.
function insetConvexRing(ring: [number, number][], d: number): [number, number][] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  cx /= ring.length;
  cy /= ring.length;
  let poly = ring;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    let nx = -(by - ay);
    let ny = bx - ax;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    if (nx * (cx - mx) + ny * (cy - my) < 0) {
      nx = -nx; // orient the normal inward (toward the centroid)
      ny = -ny;
    }
    poly = clipHalfPlane(poly, mx + nx * d, my + ny * d, nx, ny);
    if (poly.length < 3) return [];
  }
  return poly;
}

function voronoiShapes(wLen: number, hLen: number, seedIdx: number, size: number): Shape[] {
  const spacing = size * 2.2; // voronoi cells read well a bit larger than the lattice patterns
  const strut = 2.2; // fixed wall between cells, matching the lattice patterns (printable minimum)
  const n = Math.max(5, Math.round((wLen * hLen) / (spacing * spacing)));
  const rand = rng(1234 + seedIdx * 97);
  const pts: [number, number][] = Array.from({ length: n }, () => [
    (rand() - 0.5) * wLen,
    (rand() - 0.5) * hLen,
  ]);
  const voro = Delaunay.from(pts).voronoi([-wLen / 2, -hLen / 2, wLen / 2, hLen / 2]);
  const shapes: Shape[] = [];
  for (let i = 0; i < n; i++) {
    const poly = voro.cellPolygon(i);
    if (!poly || poly.length < 4) continue;
    const ring = insetConvexRing(poly.slice(0, poly.length - 1) as [number, number][], strut / 2);
    if (ring.length < 3) continue; // cell too small to keep a printable strut -> stays solid
    const sh = new Shape();
    ring.forEach((pt, j) => (j === 0 ? sh.moveTo(pt[0], pt[1]) : sh.lineTo(pt[0], pt[1])));
    sh.closePath();
    shapes.push(sh);
  }
  return shapes;
}

function polyShape(cx: number, cy: number, r: number, sides: number, rot: number): Shape {
  const s = new Shape();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function circleShape(cx: number, cy: number, r: number): Shape {
  const s = new Shape();
  s.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return s;
}

// Maximal set of multiples of `pitch` that fit within [-half, half], centred as a *block* (so an
// even count is allowed). Centring on a cell at the origin can only ever yield an odd, symmetric
// count, which silently drops a row/column whenever an even number would fit — this packs the most.
function centeredAxis(half: number, pitch: number): number[] {
  if (half < 0 || pitch <= 0) return [];
  const n = Math.floor((2 * half) / pitch) + 1; // how many fit edge-to-edge
  const start = -((n - 1) * pitch) / 2; // centre the block of n
  return Array.from({ length: n }, (_, i) => start + i * pitch);
}

// Block-centred cell centres filling the usable rect (the region inset by per-cell margin `m` so
// whole cells stay inside, keeping a clean frame). `stagger` offsets alternate rows by half a column
// for hex packing; an offset cell pushed past the usable width is dropped.
function lattice(
  wLen: number,
  hLen: number,
  dx: number,
  dy: number,
  stagger: boolean,
  m: number,
): [number, number][] {
  const xHalf = wLen / 2 - m;
  const yHalf = hLen / 2 - m;
  const xs = centeredAxis(xHalf, dx);
  const pts: [number, number][] = [];
  centeredAxis(yHalf, dy).forEach((y, ri) => {
    const off = stagger && ri % 2 === 1 ? dx / 2 : 0;
    for (const x of xs) {
      const xx = x + off;
      if (Math.abs(xx) <= xHalf + 1e-6) pts.push([xx, y]);
    }
  });
  return pts;
}

function honeycombShapes(wLen: number, hLen: number, size: number): Shape[] {
  const R = size / Math.sqrt(3); // horizontal cell pitch == size
  const cutR = Math.max(R - 2.2 / Math.sqrt(3), 0.6);
  return lattice(wLen, hLen, Math.sqrt(3) * R, 1.5 * R, true, R * 0.95).map(([x, y]) =>
    polyShape(x, y, cutR, 6, Math.PI / 2),
  ); // pointy-top -> self-supporting
}

function diamondShapes(wLen: number, hLen: number, size: number): Shape[] {
  const pitch = size;
  const cutR = Math.max((pitch - 2.4) / 2, 0.6);
  return lattice(wLen, hLen, pitch, pitch, true, cutR + 0.5).map(([x, y]) =>
    polyShape(x, y, cutR, 4, Math.PI / 2),
  ); // 45° edges -> self-supporting
}

function holesShapes(wLen: number, hLen: number, size: number): Shape[] {
  const pitch = size;
  const r = Math.max((pitch - 2.6) / 2, 0.5);
  return lattice(wLen, hLen, pitch, pitch * 0.87, true, r + 0.5).map(([x, y]) =>
    circleShape(x, y, r),
  );
}

function gridShapes(wLen: number, hLen: number, size: number): Shape[] {
  const pitch = size;
  const c = Math.max(pitch - 2.6, 0.8);
  return lattice(wLen, hLen, pitch, pitch, false, c / 2 + 0.5).map(([x, y]) =>
    rectShape(x, y, c, c),
  );
}

function wallShapes(
  style: WallStyle,
  wLen: number,
  hLen: number,
  seedIdx: number,
  size: number,
): Shape[] {
  switch (style) {
    case "louvres":
      return louvreShapes(wLen, hLen, size);
    case "voronoi":
      return voronoiShapes(wLen, hLen, seedIdx, size);
    case "honeycomb":
      return honeycombShapes(wLen, hLen, size);
    case "diamond":
      return diamondShapes(wLen, hLen, size);
    case "holes":
      return holesShapes(wLen, hLen, size);
    case "grid":
      return gridShapes(wLen, hLen, size);
    default:
      return [];
  }
}

// Column-major affine matrices mapping a (u,v) profile extruded in +Z onto a wall plane. side wall
// (normal X): local (u,v,thickness) -> world (Y, Z, X); rear wall (normal Y) -> (X, Z, −Y). These are
// 90° axis swaps, for which Manifold uses exact (rounding-free) transforms.
const SIDE_TO_WALL: Mat = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];
const REAR_TO_WALL: Mat = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

// Place a (u,v)-plane shape onto a wall: extrude through `thickness`, centre it, swap axes onto the
// wall plane, then move to the wall centreline at (px,py,cz).
function onWall(
  s: Scope,
  shape: Shape,
  kind: "side" | "rear",
  px: number,
  py: number,
  cz: number,
  thickness: number,
): Solid {
  let sol = s.extrude(shape, thickness, 8); // 8 segments/curve is plenty at cell scale
  sol = s.move(sol, 0, 0, -thickness / 2); // centre on the wall
  sol = s.transform(sol, kind === "side" ? SIDE_TO_WALL : REAR_TO_WALL);
  return s.move(sol, px, py, cz);
}

// A solid panel = rectangle minus the pattern cells, oversized by `ov` so it overlaps and bonds into
// the surrounding frame. The cells become holes baked into ONE extruded panel, so a perforated
// wall/floor costs a single union — not one boolean per cell.
function perforatedPanel(cells: Shape[], wLen: number, hLen: number, ov: number): Shape {
  const panel = rectShape(0, 0, wLen + 2 * ov, hLen + 2 * ov);
  panel.holes.push(...cells); // Shape extends Path, so each cell is a valid hole contour
  return panel;
}

export function buildTray(p: Params): BufferGeometry {
  const { innerW, innerL, outerW, outerL, H } = dims(p);
  const innerR = Math.max(p.cornerRadius - p.wall, 0.6);
  const frontLip = Math.min(p.frontLip, p.depth - 1); // 0 = open front; otherwise a low bump-stop
  const open = frontLip < 0.05; // fully open front: square the front corners (no wall to round into)
  const cW = innerW + p.wall; // wall-top centreline footprint
  const cL = innerL + p.wall;
  const cr = Math.max(p.cornerRadius - p.wall / 2, 0.5); // centreline corner radius

  const s = scope(); // tracks every Manifold so finish() frees the WASM heap after this build

  // Solid outer body, then hollow it from the floor up and out through the open top. When the front
  // is open both profiles square off their front corners so the side walls stay straight.
  let tray = s.extrude(roundedRect(outerW, outerL, p.cornerRadius, open), H);
  const cavity = s.extrude(roundedRect(innerW, innerL, innerR, open), p.depth + 1);
  tray = s.sub(tray, s.move(cavity, 0, 0, p.floor));

  // Size the ridge/groove so the groove still leaves solid floor above it.
  const hr = Math.min(p.ridgeHeight, p.floor - 0.8);
  const wr = p.ridgeWidth;
  const stack = p.stackRidge && hr > 0.3;

  // Bed adhesion: the groove is cut into the floor underside, which is the first layer on the plate.
  // Centred on the thin wall, the funnel's wide mouth leaves a razor-thin outer lip right at the bed
  // (~one extrusion line), which barely sticks. So bias the ridge+groove inward by `inset`, leaving a
  // solid outer lip (~`lipMin`) on the printed bottom; the inner side just runs into the large solid
  // floor disc, which adheres fine. Ridge and groove shift together, so stacked trays still register.
  // `maxInset` keeps the shifted ridge essentially on the wall top (≤ ~0.3 mm cavity overhang).
  const grooveMouthW = wr + 0.8; // funnel mouth, a touch wider than the ridge for self-centring
  const grooveTipW = wr + 0.3; // narrows with depth
  const lipMin = Math.max(1.0, p.wall * 0.4); // solid outer lip we aim to keep on the bed
  const maxInset = Math.max(p.wall / 2 - wr / 2 + 0.3, 0);
  const inset = stack ? Math.min(Math.max(lipMin - (p.wall - grooveMouthW) / 2, 0), maxInset) : 0;
  const rW = cW - 2 * inset; // ridge/groove ring, shifted inboard for the bed lip
  const rL = cL - 2 * inset;
  const rr = Math.max(cr - inset, 0.5);

  // Chamfered stacking ridge: tapers from full width at the wall top to a narrow tip — it self-
  // centres into the groove and prints as a self-supporting peak. Built as a full loop; the front
  // segment is removed by the open-front cut below.
  if (stack) {
    tray = s.add(tray, taperedRing(s, rW, rL, rr, wr, wr * 0.3, H - 0.1, hr + 0.1, 6, open));
  }

  // Open the front. With a lip (frontLip > 0) we only clear the wall above the lip and leave the
  // floor under it. Fully open (lip = 0) the cut goes through the floor too, so the base ends at the
  // opening instead of leaving a bare floor lip jutting out under the overhanging sheet.
  const zLow = open ? -1 : p.floor + frontLip;
  const zHigh = H + hr + 2;
  const frontCut = s.move(
    s.box(outerW + 4, p.wall + 4, zHigh - zLow),
    0,
    -outerL / 2 + p.wall / 2,
    (zLow + zHigh) / 2,
  );
  tray = s.sub(tray, frontCut);

  // Optional central grab scoop: a rounded notch on the front edge so you can pull a sheet out of a
  // tightly stacked middle tray. It dips a front lip down to the floor and bites a thumb-scallop into
  // the floor's front edge — so it helps whether the front is open (scallops the floor edge only) or
  // closed with a lip (dips the lip too).
  const scoopW = Math.min(p.scoop, innerW - 20);
  if (scoopW > 4) {
    const scoopDepth = Math.min(Math.max(scoopW * 0.4, 10), 20); // how far back it bites
    const r = Math.min(scoopW, scoopDepth) * 0.45; // rounded ends, clamped to the smaller span
    const zLow = -1;
    const zHigh = p.floor + frontLip + 2; // clear the lip (if any); just nicks the floor when open
    // A rounded-rect column centred on the front edge: the front half sits outside the part (cuts
    // nothing), the rear half bites `scoopDepth` into the floor/lip. Square front corners keep the
    // notch mouth flush with the open-front edge.
    const profile = roundedRect(scoopW, scoopDepth * 2, r, true);
    tray = s.sub(tray, s.move(s.extrude(profile, zHigh - zLow), 0, -outerL / 2, zLow));
  }

  // Chamfered groove in the floor underside: a funnel mouth at the bottom face narrowing inward, so
  // the ridge above drops in and self-centres (self-supporting, no bridge). Inset with the ridge (see
  // above) so its outer wall leaves a solid, bed-adhering lip instead of a thin sliver.
  if (stack) {
    const gDepth = hr + 0.4;
    const groove = taperedRing(
      s,
      rW,
      rL,
      rr,
      grooveMouthW,
      grooveTipW,
      -0.1,
      gDepth + 0.1,
      6,
      open,
    );
    tray = s.sub(tray, groove);
  }

  // Lightening patterns (walls + floor). Rather than booleaning every cell, we cut ONE window per
  // region and union back ONE perforated panel whose cells are baked-in Earcut holes — so a region
  // costs two booleans regardless of cell count. Openings stay vertical/cellular so they print
  // base-down, no support.
  {
    const ov = 0.8; // panel overlap into the frame, for a watertight bond
    const windows: Solid[] = [];
    const panels: Solid[] = [];

    // Walls: a flat window + perforated insert in each flat span (corners, rim, base stay solid).
    if (p.wallStyle !== "solid") {
      const m = p.wallPatternMargin;
      const wHt = p.depth - 2 * m;
      const cz = (p.floor + H) / 2;
      const sideLen = innerL - 2 * (m + 5); // a touch more border at the corners
      const rearLen = innerW - 2 * (m + 5);
      const sx = outerW / 2 - p.wall / 2; // wall centreline
      const ry = outerL / 2 - p.wall / 2;
      const cut = p.wall + 4; // window clears the full wall thickness
      const cells = (len: number, idx: number): Shape[] =>
        wallShapes(p.wallStyle, len, wHt, idx, p.wallPatternScale);
      if (wHt > 6 && sideLen > 12) {
        const c = cells(sideLen, 1);
        for (const sgn of [1, -1]) {
          windows.push(onWall(s, rectShape(0, 0, sideLen, wHt), "side", sgn * sx, 0, cz, cut));
          panels.push(
            onWall(s, perforatedPanel(c, sideLen, wHt, ov), "side", sgn * sx, 0, cz, p.wall),
          );
        }
      }
      if (wHt > 6 && rearLen > 12) {
        const c = cells(rearLen, 2);
        windows.push(onWall(s, rectShape(0, 0, rearLen, wHt), "rear", 0, ry, cz, cut));
        panels.push(onWall(s, perforatedPanel(c, rearLen, wHt, ov), "rear", 0, ry, cz, p.wall));
      }
    }

    // Floor: a window + perforated plate over the interior base (the groove ring lives under the
    // walls, so it stays solid). Holes are vertical through-cuts in a flat plate — no bridging.
    if (p.floorStyle !== "solid") {
      const m = p.floorPatternMargin;
      const fW = innerW - 2 * m;
      const fL = innerL - 2 * m;
      if (fW > 12 && fL > 12) {
        const c = wallShapes(p.floorStyle, fW, fL, 3, p.floorPatternScale);
        windows.push(s.move(s.extrude(rectShape(0, 0, fW, fL), p.floor + 2), 0, 0, -1));
        panels.push(s.extrude(perforatedPanel(c, fW, fL, ov), p.floor, 8)); // z = 0 .. floor
      }
    }

    if (windows.length > 0) {
      tray = s.sub(tray, s.union(windows));
      tray = s.add(tray, s.union(panels));
    }
  }

  // Optional snap-rails for the removable label clip: a short T-rail (stem + wider head) on the front
  // face of each side wall, near the top. They live on the side walls, so they're present whether the
  // front is open or closed, and stop below the wall top so a stacked tray clears the rail + clip.
  if (p.labelRail) {
    const place = labelRailPlacement(p);
    if (place) {
      const { railLen, z, xRight } = place;
      const yF = -outerL / 2;
      const { stemW, stemY, headW, headT } = RAIL;
      for (const sgn of [1, -1]) {
        const xc = sgn * xRight;
        // The stem overlaps 0.6 mm into the wall and 0.4 mm into the head so the union bonds solidly.
        const stem = s.move(s.box(stemW, stemY + 1.0, railLen), xc, yF - stemY / 2 + 0.1, z);
        const head = s.move(s.box(headW, headT, railLen), xc, yF - stemY - headT / 2, z);
        tray = s.add(tray, s.union([stem, head]));
      }
    }
  }

  const geom = s.finish(tray);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}
