// Reusable 2D profiles (THREE.Shape / Path) that the geometry builder extrudes through manifold-3d.
// Pure and framework-light — only depends on three's Shape/Path containers, no solid-modelling here.

import { Path, Shape } from "three";

// Trace a rounded rectangle (centred on the origin, XY plane) onto a Path or Shape. With
// `squareFront`, the two front corners (−Y, the open-front edge) are left square: with no front wall
// there's nothing to round into, so a rounded corner just makes the side walls curve inward. Square
// them and the walls run straight to the front. Same footprint either way — only the corner shape
// changes, so dimensions and bed fit are unaffected.
export function roundedRectInto<T extends Path>(
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

export function roundedRect(w: number, l: number, r: number, squareFront = false): Shape {
  return roundedRectInto(new Shape(), w, l, r, squareFront);
}

export function rectShape(cx: number, cy: number, w: number, h: number): Shape {
  const s = new Shape();
  s.moveTo(cx - w / 2, cy - h / 2);
  s.lineTo(cx + w / 2, cy - h / 2);
  s.lineTo(cx + w / 2, cy + h / 2);
  s.lineTo(cx - w / 2, cy + h / 2);
  s.closePath();
  return s;
}

// An isosceles trapezoid for the label dovetail rail, centred on the origin in the XY plane and
// extruded vertically (+Z) by the caller. `neckW` is the width (X) at the +Y edge — the neck, where the
// rail meets the tray — and `tipW` the width at the −Y edge (the flared front tip); `depthY` is the Y
// span. tipW > neckW makes it an undercut dovetail: a label slid down onto it can't pull off forward
// (−Y), since the widening rib jams against the narrowing socket mouth.
export function dovetailShape(neckW: number, tipW: number, depthY: number): Shape {
  const s = new Shape();
  const hd = depthY / 2;
  s.moveTo(-tipW / 2, -hd); // front-left (−Y, wide tip)
  s.lineTo(tipW / 2, -hd); // front-right
  s.lineTo(neckW / 2, hd); // back-right (+Y, narrow neck)
  s.lineTo(-neckW / 2, hd); // back-left
  s.closePath();
  return s;
}

// A rounded-rectangular ring profile (outer rounded rect minus an inner one), ready to extrude.
// Used for the tapered stacking ridge/groove slices.
export function ringShape(
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

export function polyShape(cx: number, cy: number, r: number, sides: number, rot: number): Shape {
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

export function circleShape(cx: number, cy: number, r: number): Shape {
  const s = new Shape();
  s.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return s;
}

// A solid panel = rectangle minus the pattern cells, oversized by `ov` so it overlaps and bonds into
// the surrounding frame. The cells become holes baked into ONE extruded panel, so a perforated
// wall/floor costs a single union — not one boolean per cell.
export function perforatedPanel(cells: Shape[], wLen: number, hLen: number, ov: number): Shape {
  const panel = rectShape(0, 0, wLen + 2 * ov, hLen + 2 * ov);
  panel.holes.push(...cells); // Shape extends Path, so each cell is a valid hole contour
  return panel;
}
