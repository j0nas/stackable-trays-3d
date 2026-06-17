// Wall/floor lightening patterns: each generator returns a set of 2D cell shapes in local
// (u = along the span, v = vertical) coordinates, which the tray builder bakes into a single
// perforated panel. Cell SIZE is `size` (the pattern-scale slider).
//
// The border is the CALLER's job: it passes an already-inset span, inset by the "Pattern margin" from
// the region's true edges, and the cells just fill whatever span they're given. So the margin reads as
// the same border whether it's a wall or the floor — there's no per-style or per-region inset hidden
// here. (A size-relative inset baked in here is what once collapsed the short walls; keeping the
// generators "fill the span" and letting the caller own the margin is what prevents that.)

import { Shape } from "three";
import { Delaunay } from "d3-delaunay";
import type { WallStyle } from "./params.ts";
import { circleShape, polyShape, rectShape } from "./shapes.ts";

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
  // Fill the given (already margin-inset) span. Bail only when there's genuinely no room for one
  // strutted cell — NOT merely "smaller than a cell"; returning [] for a short-but-usable field is what
  // once made voronoi walls vanish. Let it fit fewer, box-clipped cells instead.
  if (wLen < strut * 3 || hLen < strut * 3) return [];
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

// The cells for a given style over a `wLen × hLen` span (already inset by the region margin, so the
// margin reads as the same border on walls and floor). `seedIdx` keeps each region's voronoi distinct
// but stable. "solid" returns none (the caller skips it).
export function wallShapes(
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
