// Pure geometry builder: Params -> a single watertight THREE.BufferGeometry, ready for both the
// live preview and STL export. Modelled with Z up and the base on z = 0 (millimetres), which is
// what slicers expect, so the exported STL drops onto the Bambu plate at true size.
//
// Three.js is a render-mesh library, not a solid modeller, so the boolean solid operations are
// done with three-bvh-csg, which produces manifold output suitable for printing. Everything is
// designed to print base-down with NO supports: walls are vertical, every opening's top only
// bridges a short span, and the stacking ridge/groove are tapered so they self-support.

import { BoxGeometry, type BufferGeometry, ExtrudeGeometry, Matrix4, Path, Shape } from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { Delaunay } from "d3-delaunay";
import { ADDITION, Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { dims, type Params, type WallStyle } from "./params.ts";

// Trace a rounded rectangle (centred on the origin, XY plane) onto a Path or Shape.
function roundedRectInto<T extends Path>(path: T, w: number, l: number, radius: number): T {
  const hw = w / 2;
  const hl = l / 2;
  const r = Math.max(Math.min(radius, hw - 0.01, hl - 0.01), 0);
  path.moveTo(-hw + r, -hl);
  path.lineTo(hw - r, -hl);
  path.absarc(hw - r, -hl + r, r, -Math.PI / 2, 0, false);
  path.lineTo(hw, hl - r);
  path.absarc(hw - r, hl - r, r, 0, Math.PI / 2, false);
  path.lineTo(-hw + r, hl);
  path.absarc(-hw + r, hl - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(-hw, -hl + r);
  path.absarc(-hw + r, -hl + r, r, Math.PI, Math.PI * 1.5, false);
  path.closePath();
  return path;
}

function roundedRect(w: number, l: number, r: number): Shape {
  return roundedRectInto(new Shape(), w, l, r);
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

// Extrude a 2D shape up the +Z axis (z = 0 .. height). Indexed so three-bvh-csg can consume it.
function prism(shape: Shape, height: number): BufferGeometry {
  return mergeVertices(
    new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 }),
  );
}

function ringGeom(
  oW: number,
  oL: number,
  oR: number,
  iW: number,
  iL: number,
  iR: number,
  h: number,
): BufferGeometry {
  const s = roundedRect(oW, oL, oR);
  s.holes.push(roundedRectInto(new Path(), iW, iL, iR));
  return mergeVertices(new ExtrudeGeometry(s, { depth: h, bevelEnabled: false, steps: 1 }));
}

// A loop with a tapered (chamfered) cross-section, approximated as a stack of thin ring slices that
// shrink from `wBottom` (full thickness at zBottom) to `wTop`. Used for the self-registering
// stacking ridge (peak up) and the funnel groove (wide mouth) — both print without support.
function taperedRing(
  cW: number,
  cL: number,
  cr: number,
  wBottom: number,
  wTop: number,
  zBottom: number,
  height: number,
  slices: number,
): BufferGeometry {
  const geos: BufferGeometry[] = [];
  const dh = height / slices;
  for (let i = 0; i < slices; i++) {
    const f = (i + 0.5) / slices;
    const w = wBottom + (wTop - wBottom) * f;
    const g = ringGeom(
      cW + w,
      cL + w,
      Math.max(cr + w / 2, 0.5),
      cW - w,
      cL - w,
      Math.max(cr - w / 2, 0.3),
      dh + 0.08,
    );
    g.translate(0, 0, zBottom + i * dh - 0.04);
    geos.push(g);
  }
  return mergeGeometries(geos, false);
}

const evaluator = new Evaluator();
evaluator.useGroups = false;

function brush(geom: BufferGeometry, x = 0, y = 0, z = 0): Brush {
  const b = new Brush(geom);
  b.position.set(x, y, z);
  b.updateMatrixWorld();
  return b;
}

function op(target: Brush, geom: BufferGeometry, mode: number, x = 0, y = 0, z = 0): Brush {
  const result = evaluator.evaluate(target, brush(geom, x, y, z), mode);
  result.updateMatrixWorld();
  return result;
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

// Orient a (u,v)-plane shape onto a wall and extrude it through `thickness`.
// side wall (normal X): local (u,v) -> world (Y, Z); rear wall (normal Y): local (u,v) -> (X, Z).
function onWall(
  shape: Shape,
  kind: "side" | "rear",
  px: number,
  py: number,
  cz: number,
  thickness: number,
): BufferGeometry {
  const rot = new Matrix4();
  if (kind === "side") rot.set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  else rot.set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  const g = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 8, // only affects round holes; 8 is plenty at cell scale
  });
  g.translate(0, 0, -thickness / 2); // centre on the wall
  g.applyMatrix4(rot);
  g.translate(px, py, cz);
  return g;
}

// A solid panel = rectangle minus the pattern cells, oversized by `ov` so it overlaps and bonds
// into the surrounding frame. The cells become holes baked into ONE Earcut'd extrude, so a
// perforated wall/floor costs a single union — not one CSG boolean per cell (which scales ~cubically
// in three-bvh-csg and made dense floors take ~minutes).
function perforatedPanel(cells: Shape[], wLen: number, hLen: number, ov: number): Shape {
  const panel = rectShape(0, 0, wLen + 2 * ov, hLen + 2 * ov);
  panel.holes.push(...cells); // Shape extends Path, so each cell is a valid hole contour
  return panel;
}

export function buildTray(p: Params): BufferGeometry {
  const { innerW, innerL, outerW, outerL, H } = dims(p);
  const innerR = Math.max(p.cornerRadius - p.wall, 0.6);
  const frontLip = Math.min(p.frontLip, p.depth - 1); // 0 = open front; otherwise a low bump-stop
  const cW = innerW + p.wall; // wall-top centreline footprint
  const cL = innerL + p.wall;
  const cr = Math.max(p.cornerRadius - p.wall / 2, 0.5); // centreline corner radius

  // Solid outer body, then hollow it from the floor up and out through the open top.
  let tray: Brush = brush(prism(roundedRect(outerW, outerL, p.cornerRadius), H));
  tray = op(
    tray,
    prism(roundedRect(innerW, innerL, innerR), p.depth + 1),
    SUBTRACTION,
    0,
    0,
    p.floor,
  );

  // Size the ridge/groove so the groove still leaves solid floor above it.
  const hr = Math.min(p.ridgeHeight, p.floor - 0.8);
  const wr = p.ridgeWidth;
  const stack = p.stackRidge && hr > 0.3;

  // Chamfered stacking ridge: tapers from full width at the wall top to a narrow tip — it self-
  // centres into the groove and prints as a self-supporting peak. Built as a full loop; the front
  // segment is removed by the open-front cut below.
  if (stack) {
    tray = op(tray, taperedRing(cW, cL, cr, wr, wr * 0.3, H - 0.1, hr + 0.1, 6), ADDITION);
  }

  // Open the front. With a lip (frontLip > 0) we only clear the wall above the lip and leave the
  // floor under it. Fully open (lip = 0) the cut goes through the floor too, so the base ends at the
  // opening instead of leaving a bare floor lip jutting out under the overhanging sheet.
  const open = frontLip < 0.05;
  const zLow = open ? -1 : p.floor + frontLip;
  const zHigh = H + hr + 2;
  tray = op(
    tray,
    new BoxGeometry(outerW + 4, p.wall + 4, zHigh - zLow),
    SUBTRACTION,
    0,
    -outerL / 2 + p.wall / 2,
    (zLow + zHigh) / 2,
  );

  // Chamfered groove in the floor underside: a wide funnel mouth at the bottom face narrowing in,
  // so the ridge above drops in and self-centres. The funnel is self-supporting (no bridge).
  if (stack) {
    const gDepth = hr + 0.4;
    tray = op(
      tray,
      taperedRing(cW, cL, cr, wr + 1.0, wr + 0.4, -0.1, gDepth + 0.1, 6),
      SUBTRACTION,
    );
  }

  // Lightening patterns (walls + floor). Instead of CSG-subtracting every cell — each boolean scales
  // ~cubically in three-bvh-csg, so a dense floor took ~minutes — we cut ONE window per region and
  // union back ONE perforated panel whose cells are baked-in Earcut holes. Two booleans total,
  // independent of cell count. Openings stay vertical/cellular so they print base-down, no support.
  {
    const m = p.patternMargin;
    const ov = 0.8; // panel overlap into the frame, for a watertight bond
    const windows: BufferGeometry[] = [];
    const panels: BufferGeometry[] = [];

    // Walls: a flat window + perforated insert in each flat span (corners, rim, base stay solid).
    if (p.wallStyle !== "solid") {
      const wHt = p.depth - 2 * m;
      const cz = (p.floor + H) / 2;
      const sideLen = innerL - 2 * (m + 5); // a touch more border at the corners
      const rearLen = innerW - 2 * (m + 5);
      const sx = outerW / 2 - p.wall / 2; // wall centreline
      const ry = outerL / 2 - p.wall / 2;
      const cut = p.wall + 4; // window clears the full wall thickness
      const cells = (len: number, idx: number): Shape[] =>
        wallShapes(p.wallStyle, len, wHt, idx, p.patternScale);
      if (wHt > 6 && sideLen > 12) {
        const c = cells(sideLen, 1);
        for (const sgn of [1, -1]) {
          windows.push(onWall(rectShape(0, 0, sideLen, wHt), "side", sgn * sx, 0, cz, cut));
          panels.push(
            onWall(perforatedPanel(c, sideLen, wHt, ov), "side", sgn * sx, 0, cz, p.wall),
          );
        }
      }
      if (wHt > 6 && rearLen > 12) {
        const c = cells(rearLen, 2);
        windows.push(onWall(rectShape(0, 0, rearLen, wHt), "rear", 0, ry, cz, cut));
        panels.push(onWall(perforatedPanel(c, rearLen, wHt, ov), "rear", 0, ry, cz, p.wall));
      }
    }

    // Floor: a window + perforated plate over the interior base (the groove ring lives under the
    // walls, so it stays solid). Holes are vertical through-cuts in a flat plate — no bridging.
    if (p.floorStyle !== "solid") {
      const fW = innerW - 2 * m;
      const fL = innerL - 2 * m;
      if (fW > 12 && fL > 12) {
        const c = wallShapes(p.floorStyle, fW, fL, 3, p.patternScale);
        const win = new ExtrudeGeometry(rectShape(0, 0, fW, fL), {
          depth: p.floor + 2,
          bevelEnabled: false,
          steps: 1,
        });
        win.translate(0, 0, -1);
        windows.push(win);
        panels.push(
          new ExtrudeGeometry(perforatedPanel(c, fW, fL, ov), {
            depth: p.floor,
            bevelEnabled: false,
            steps: 1,
            curveSegments: 8,
          }), // extrudes z = 0 .. floor
        );
      }
    }

    if (windows.length > 0) {
      tray = op(tray, mergeVertices(mergeGeometries(windows, false)), SUBTRACTION);
      tray = op(tray, mergeVertices(mergeGeometries(panels, false)), ADDITION);
    }
  }

  const geom = tray.geometry;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}
