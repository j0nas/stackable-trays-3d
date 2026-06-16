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

function louvreShapes(wLen: number, hLen: number): Shape[] {
  const slotW = 8;
  const gap = 7;
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

function voronoiShapes(wLen: number, hLen: number, seedIdx: number): Shape[] {
  const n = Math.max(5, Math.round((wLen * hLen) / (22 * 22)));
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
    const ring = poly.slice(0, poly.length - 1);
    let cx = 0;
    let cy = 0;
    for (const pt of ring) {
      cx += pt[0];
      cy += pt[1];
    }
    cx /= ring.length;
    cy /= ring.length;
    const k = 0.78; // shrink each cell toward its centroid -> strut gap between cells
    const sh = new Shape();
    ring.forEach((pt, j) => {
      const x = cx + (pt[0] - cx) * k;
      const y = cy + (pt[1] - cy) * k;
      if (j === 0) sh.moveTo(x, y);
      else sh.lineTo(x, y);
    });
    sh.closePath();
    shapes.push(sh);
  }
  return shapes;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

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

// Cell centres covering the usable rect; `stagger` offsets alternate rows (hex packing).
function lattice(
  wLen: number,
  hLen: number,
  dx: number,
  dy: number,
  stagger: boolean,
): [number, number][] {
  const nx = Math.ceil(wLen / 2 / dx) + 1;
  const ny = Math.ceil(hLen / 2 / dy) + 1;
  const pts: [number, number][] = [];
  for (let r = -ny; r <= ny; r++) {
    const ox = stagger && ((r % 2) + 2) % 2 === 1 ? dx / 2 : 0;
    for (let c = -nx; c <= nx; c++) pts.push([c * dx + ox, r * dy]);
  }
  return pts;
}

// Keep a cell only if it stays fully inside the usable rect (so a clean frame remains).
function fits(p: [number, number], wLen: number, hLen: number, m: number): boolean {
  return Math.abs(p[0]) <= wLen / 2 - m && Math.abs(p[1]) <= hLen / 2 - m;
}

function honeycombShapes(wLen: number, hLen: number): Shape[] {
  const R = clamp(hLen / 6, 3.5, 8);
  const cutR = R - 2.2 / Math.sqrt(3);
  return lattice(wLen, hLen, Math.sqrt(3) * R, 1.5 * R, true)
    .filter((p) => fits(p, wLen, hLen, R * 0.95))
    .map(([x, y]) => polyShape(x, y, cutR, 6, Math.PI / 2)); // pointy-top -> self-supporting
}

function diamondShapes(wLen: number, hLen: number): Shape[] {
  const pitch = clamp(hLen / 4, 7, 13);
  const cutR = (pitch - 2.4) / 2;
  return lattice(wLen, hLen, pitch, pitch, true)
    .filter((p) => fits(p, wLen, hLen, cutR + 0.5))
    .map(([x, y]) => polyShape(x, y, cutR, 4, Math.PI / 2)); // 45° edges -> self-supporting
}

function holesShapes(wLen: number, hLen: number): Shape[] {
  const pitch = clamp(hLen / 4, 6.5, 12);
  const r = (pitch - 2.6) / 2;
  return lattice(wLen, hLen, pitch, pitch * 0.87, true)
    .filter((p) => fits(p, wLen, hLen, r + 0.5))
    .map(([x, y]) => circleShape(x, y, r));
}

function gridShapes(wLen: number, hLen: number): Shape[] {
  const pitch = clamp(hLen / 3.5, 7.5, 13);
  const c = pitch - 2.6;
  return lattice(wLen, hLen, pitch, pitch, false)
    .filter((p) => fits(p, wLen, hLen, c / 2 + 0.5))
    .map(([x, y]) => rectShape(x, y, c, c));
}

function wallShapes(style: WallStyle, wLen: number, hLen: number, seedIdx: number): Shape[] {
  switch (style) {
    case "louvres":
      return louvreShapes(wLen, hLen);
    case "voronoi":
      return voronoiShapes(wLen, hLen, seedIdx);
    case "honeycomb":
      return honeycombShapes(wLen, hLen);
    case "diamond":
      return diamondShapes(wLen, hLen);
    case "holes":
      return holesShapes(wLen, hLen);
    case "grid":
      return gridShapes(wLen, hLen);
    default:
      return [];
  }
}

// Extrude wall-pattern shapes through a wall and orient them onto that wall.
// side wall (normal X): local (u,v) -> world (Y, Z); rear wall (normal Y): local (u,v) -> (X, Z).
function wallCutters(
  shapes: Shape[],
  kind: "side" | "rear",
  px: number,
  py: number,
  cz: number,
  thickness: number,
): BufferGeometry[] {
  const rot = new Matrix4();
  if (kind === "side") rot.set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  else rot.set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  return shapes.map((sh) => {
    const g = mergeVertices(
      new ExtrudeGeometry(sh, {
        depth: thickness,
        bevelEnabled: false,
        steps: 1,
        curveSegments: 10,
      }),
    );
    g.translate(0, 0, -thickness / 2); // centre the cut on the wall
    g.applyMatrix4(rot);
    g.translate(px, py, cz);
    return g;
  });
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

  // Wall pattern (lightening + looks). All openings are vertical/cellular so their tops bridge only
  // a short span — printable base-down without support.
  if (p.wallStyle !== "solid") {
    const bV = p.patternMargin; // border top/bottom (keeps the rim, ridge and a base flange solid)
    const bEnd = p.patternMargin + 5; // a touch more at the corners for strength
    const wHt = p.depth - 2 * bV;
    const cz = (p.floor + H) / 2;
    const sideLen = innerL - 2 * bEnd;
    const rearLen = innerW - 2 * bEnd;
    const T = p.wall + 4;
    if (wHt > 6) {
      const make = (len: number, idx: number): Shape[] => wallShapes(p.wallStyle, len, wHt, idx);
      const cutters: BufferGeometry[] = [];
      if (sideLen > 12) {
        const s = make(sideLen, 1);
        cutters.push(...wallCutters(s, "side", outerW / 2, 0, cz, T));
        cutters.push(...wallCutters(s, "side", -outerW / 2, 0, cz, T));
      }
      if (rearLen > 12) {
        cutters.push(...wallCutters(make(rearLen, 2), "rear", 0, outerL / 2, cz, T));
      }
      if (cutters.length > 0) {
        tray = op(tray, mergeGeometries(cutters, false), SUBTRACTION);
      }
    }
  }

  // Floor pattern (optional): perforate the interior base to save filament. These are vertical
  // through-holes in a flat plate, so they print without bridging. Inset by the same margin so a
  // solid frame stays under the paper and clear of the perimeter groove ring.
  if (p.floorStyle !== "solid") {
    const m = p.patternMargin;
    const fW = innerW - 2 * m;
    const fL = innerL - 2 * m;
    if (fW > 12 && fL > 12) {
      const cutters = wallShapes(p.floorStyle, fW, fL, 3).map((sh) => {
        const g = prism(sh, p.floor + 2);
        g.translate(0, 0, -1); // pierce the full floor thickness (z = 0 .. floor)
        return g;
      });
      if (cutters.length > 0) {
        tray = op(tray, mergeGeometries(cutters, false), SUBTRACTION);
      }
    }
  }

  const geom = tray.geometry;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}
