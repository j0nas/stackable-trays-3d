// Pure geometry builder: Params -> a single watertight THREE.BufferGeometry, ready for both the
// live preview and STL export. Modelled with Z up and the base on z = 0 (millimetres), which is
// what slicers expect, so the exported STL drops onto the Bambu plate at true size.
//
// Three.js is a render-mesh library, not a solid modeller, so the boolean solid operations run
// through manifold-3d (see csg.ts), which guarantees watertight 2-manifold output suitable for
// printing. Everything is designed to print base-down with NO supports: walls are vertical, every
// opening's top only bridges a short span, and the stacking ridge/groove are tapered so they
// self-support.
//
// This file is the assembly: 2D profiles come from shapes.ts, lightening patterns from patterns.ts,
// and the boolean ops from csg.ts. buildTray() reads as a pipeline — body, stacking ridge, front
// opening, scoop, groove, patterns, label rails — with each step a small named helper below.

import type { BufferGeometry, Shape } from "three";
import { type Mat, type Scope, type Solid, scope } from "./csg.ts";
import { RAIL } from "./label.ts";
import { type Dims, dims, type LabelSide, type Params } from "./params.ts";
import { wallShapes } from "./patterns.ts";
import { dovetailShape, perforatedPanel, rectShape, ringShape, roundedRect } from "./shapes.ts";

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

// --- label rail placement ----------------------------------------------------

function railSides(side: LabelSide): ("left" | "right")[] {
  if (side === "both") return ["left", "right"];
  if (side === "left" || side === "right") return [side];
  return [];
}

// Placement for the floor-anchored label rail(s), shared by the geometry (tray.ts builds the rib) and
// the viewer (drops a clip preview onto each). Each rib rises from the floor's front edge at a front
// corner and projects forward — the floor is always there, unlike the front wall, which is cut away on
// an open front or above a lip. Returns null when no side is selected or the tray is too shallow.
export function labelRailPlacement(p: Params): {
  railLen: number;
  baseZ: number; // floor top = rail bottom = clip bottom
  faceY: number; // tray front face: the rib's neck plane and the clip's back
  sides: ("left" | "right")[];
  x: { left: number; right: number }; // rib centre X per side
} | null {
  const sides = railSides(p.labelRail);
  if (sides.length === 0) return null;
  // Only offer a rail when the full-height clip clears the wall top with margin — a 20 mm label on a
  // shallow tray would poke into the tray stacked above. (RAIL.len + 4 ≈ a couple of layers of slack.)
  if (p.depth < RAIL.len + 4) return null;
  const d = dims(p);
  const open = Math.min(p.frontLip, p.depth) < 0.05;
  // Keep the rib inboard of the front corner so it always welds to the straight front face/edge. An
  // open front squares its front corners (the edge runs straight to the side wall), but a lip or closed
  // front rounds them by cornerRadius — a rib placed out in that curve would weld to nothing and print
  // as a loose piece. `straight` is the half-length of the straight front section; sit the rib (its wide
  // tip) just inside it, or near the corner when that's tighter.
  const frontCornerR = open ? 0 : p.cornerRadius;
  const straight = d.outerW / 2 - frontCornerR;
  const xMag = Math.min(d.innerW / 2 - RAIL.tipW / 2 - 1.5, straight - RAIL.tipW / 2 - 0.5);
  return {
    railLen: RAIL.len,
    baseZ: p.floor, // floor top = the seat the clip's stop bottoms on
    faceY: floorFrontY(p, d, open),
    sides,
    x: { left: -xMag, right: xMag },
  };
}

// --- build steps (each takes the current solid and returns the next) ---------

// The front edge of the floor: pulled back to where the open-front cut ends, or at the outer face
// when a lip keeps the floor full-depth. Both the scoop and the label rails anchor to it.
function floorFrontY(p: Params, d: Dims, open: boolean): number {
  return open ? -d.outerL / 2 + p.wall + 2 : -d.outerL / 2;
}

// Optional central grab scoop, so you can pull a sheet out of a tightly stacked middle tray. `scoop`
// is the width, `scoopDepth` how far it bites back into the floor (set either to 0 to disable).
// Corners follow the body `cornerRadius`. Placement + size live here so both the actual cut (cutScoop)
// and the floor-pattern border (applyPatterns reserves a solid frame around it) agree. Returns null
// when disabled.
function scoopDims(p: Params, d: Dims): { w: number; sd: number; r: number; fy: number } | null {
  const w = Math.min(p.scoop, d.innerW - 20);
  if (w <= 4 || p.scoopDepth <= 0.5) return null; // disabled (width or depth ~0)
  const sd = Math.min(p.scoopDepth, d.innerL - 30); // bite into the floor, clamped clear of the back
  const r = Math.max(Math.min(p.cornerRadius, w / 2 - 0.1, sd - 0.1), 0.5);
  const open = Math.min(p.frontLip, p.depth - 1) < 0.05;
  return { w, sd, r, fy: floorFrontY(p, d, open) };
}

// Cut the notch. It removes any front lip in that span AND cuts down through the floor, so it helps
// whether the front is open or closed.
function cutScoop(s: Scope, p: Params, tray: Solid, d: Dims, frontLip: number): Solid {
  const sc = scoopDims(p, d);
  if (!sc) return tray;
  const zLow = -1;
  const zHigh = p.floor + frontLip + 2; // remove the lip (if any) down through the floor
  // A rounded-rect column centred on the front edge: the front half sits outside the part (cuts
  // nothing), the rear half bites `sd` in. Square front corners keep the notch mouth flush with the
  // edge; the rear corners take the rounded `cornerRadius`.
  const profile = roundedRect(sc.w, sc.sd * 2, sc.r, true);
  return s.sub(tray, s.move(s.extrude(profile, zHigh - zLow), 0, sc.fy, zLow));
}

// Lightening patterns (walls + floor). Rather than booleaning every cell, we cut ONE window per
// region and union back ONE perforated panel whose cells are baked-in holes — so a region costs two
// booleans regardless of cell count. Openings stay vertical/cellular so they print base-down.
function applyPatterns(s: Scope, p: Params, tray: Solid, d: Dims): Solid {
  const { innerW, innerL, outerW, outerL, H } = d;
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

    // Front lip: when a front wall exists (a partial lip or a full closed front) pattern it like the
    // other three. The lip spans floor..floor+frontLip; pattern the band inside the m margins, centred
    // on the lip (when closed this is the full wall, identical to the rear). A short lip can't fit a
    // pattern plus its top/bottom borders, so it stays solid.
    const frontLip = Math.min(p.frontLip, p.depth);
    const lipHt = frontLip - 2 * m;
    if (lipHt > 6 && rearLen > 12) {
      const czFront = p.floor + frontLip / 2;
      const c = wallShapes(p.wallStyle, rearLen, lipHt, 4, p.wallPatternScale);
      let win = onWall(s, rectShape(0, 0, rearLen, lipHt), "rear", 0, -ry, czFront, cut);
      // The scoop cuts a full-height strip out of the lip, so reserve an m border around it (carve the
      // dilated scoop span out of the window) — the re-added panel's cells there sit over solid wall and
      // fill in, then cutScoop removes the clean notch. Same trick as the floor.
      const sc = scoopDims(p, d);
      if (sc) win = s.sub(win, s.move(s.box(sc.w + 2 * m, cut + 4, lipHt + 4), 0, -ry, czFront));
      windows.push(win);
      panels.push(
        onWall(s, perforatedPanel(c, rearLen, lipHt, ov), "rear", 0, -ry, czFront, p.wall),
      );
    }
  }

  // Floor: a window + perforated plate over the interior base (the groove ring lives under the walls,
  // so it stays solid). Holes are vertical through-cuts in a flat plate — no bridging.
  if (p.floorStyle !== "solid") {
    const m = p.floorPatternMargin;
    // Inset the window by m from the floor's TRUE edges, so the margin reads as the actual border, the
    // same as the walls. The open front pulls the floor's front edge back, so measure the front from
    // there — a window centred on the footprint would leave only m−2 at the front (nothing at m=2).
    const open = Math.min(p.frontLip, p.depth) < 0.05;
    const frontEdge = open ? floorFrontY(p, d, true) : -innerL / 2;
    const fFront = frontEdge + m;
    const fBack = innerL / 2 - m;
    const fW = innerW - 2 * m;
    const fL = fBack - fFront;
    const fcy = (fFront + fBack) / 2; // window centre (off origin once the open front shortens it)
    // Round the window's corners to follow the cavity's rounded corners (radius innerR) at the same m
    // offset, so the pattern fills into the corner and the solid border stays a uniform width. A plain
    // rectangle leaves a square corner that, at a generous corner radius, pokes a sharp wedge into the
    // rounded corner and thins the border there. Front corners stay square on an open front (no wall to
    // round into), matching the body. innerR < m clamps to a near-square corner — the correct uniform
    // inset when the corner is tighter than the margin.
    const innerR = Math.max(p.cornerRadius - p.wall, 0.6);
    const winR = Math.max(innerR - m, 0.5);
    if (fW > 12 && fL > 12) {
      const c = wallShapes(p.floorStyle, fW, fL, 3, p.floorPatternScale);
      let win = s.move(s.extrude(roundedRect(fW, fL, winR, open), p.floor + 2), 0, fcy, -1);
      // Reserve the same m border around the scoop: bite the m-dilated scoop out of the window so the
      // floor stays solid there; cutScoop later removes the un-dilated notch, leaving an m border (matching
      // the perimeter) instead of stray cut-off cell ends along the scoop edge. Holes left in the re-added
      // panel here sit over still-solid floor, so they fill in.
      const sc = scoopDims(p, d);
      if (sc) {
        const pad = roundedRect(sc.w + 2 * m, sc.sd * 2 + 2 * m, sc.r + m, true);
        win = s.sub(win, s.move(s.extrude(pad, p.floor + 4), 0, sc.fy, -2));
      }
      windows.push(win);
      // Clip the perforated panel (a plain rectangle) to the SAME rounded footprint as the window,
      // grown by the bond overlap `ov`. Without this its square corners poke past the rounded corner —
      // through the lip and stacking groove — once the corner radius gets aggressive (the panel is a
      // separate rectangle added back over the floor). Intersecting keeps the cells' clean rectangular
      // EvenOdd fill while rounding the outline.
      const panel = s.extrude(perforatedPanel(c, fW, fL, ov), p.floor, 8);
      const clip = s.move(
        s.extrude(roundedRect(fW + 2 * ov, fL + 2 * ov, winR + ov, open), p.floor + 4),
        0,
        0,
        -2,
      );
      panels.push(s.move(s.intersect(panel, clip), 0, fcy, 0));
    }
  }

  if (windows.length === 0) return tray;
  tray = s.sub(tray, s.union(windows));
  return s.add(tray, s.union(panels));
}

// Optional label-clip rails: a short dovetail rib GLUED onto the tray's front face at the chosen
// corner(s). The rib's neck overlaps the face by a hairline `weld` — just enough for a watertight
// union — and nothing more reaches into the body, so it never touches the stacking ridge (wall top) or
// the groove (floor underside): a closed or partial front still nests cleanly. The rib's mass projects
// forward and tops out well below the wall, so a stacked tray clears it. A small foot straddles the
// floor's front edge (always present, unlike the front wall) to weld the rib down; it sits above the
// groove, so even a closed front keeps a clean nest.
function addLabelRails(s: Scope, p: Params, tray: Solid): Solid {
  const place = labelRailPlacement(p);
  if (!place) return tray;
  const { railLen, baseZ, faceY, x, sides } = place;
  const { neckW, tipW, projY } = RAIL;
  // Hairline overlap into the face — fuses the rib to the body without protruding into it. The groove
  // never rises above baseZ − 0.4 (gDepth ≤ floor − 0.4), so the foot below clears it for any config.
  const weld = 0.4;
  for (const side of sides) {
    const xc = side === "left" ? x.left : x.right;
    // Dovetail flare: rises from z = baseZ (its underside is the shoulder the clip's stop seats on),
    // projecting forward. dovetailShape is centred with its neck (+Y) edge at +projY/2, so shift it so
    // the neck overlaps the face by `weld` and the wider tip leads. Run it 2 mm short of the clip's
    // socket depth so the rib top tucks just inside the socket mouth rather than poking out.
    let flare = s.extrude(dovetailShape(neckW, tipW, projY), railLen - 2);
    flare = s.move(flare, xc, faceY + weld - projY / 2, baseZ);
    // Foot: a hairline weld straddling the floor top (z = baseZ ± 0.4) that bridges the rib to the
    // floor's front edge. Kept above the stacking groove, so it never fouls the nest, and it bites only
    // `weld` into the body — flush-glued, not a post sunk into the floor.
    const foot = s.move(s.box(neckW, weld, 0.8), xc, faceY + weld / 2, baseZ);
    tray = s.add(tray, s.union([flare, foot]));
  }
  return tray;
}

// --- assembly ----------------------------------------------------------------

export function buildTray(p: Params): BufferGeometry {
  const d = dims(p);
  const { innerW, innerL, outerW, outerL, H } = d;
  const innerR = Math.max(p.cornerRadius - p.wall, 0.6);
  const frontLip = Math.min(p.frontLip, p.depth); // 0 = open front; p.depth = full closed front wall
  const open = frontLip < 0.05; // fully open front: square the front corners (no wall to round into)
  const frontClosed = frontLip >= p.depth - 0.05; // lip reaches the wall top: closed front, full ridge
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
  const grooveMouthW = wr + 0.8; // funnel mouth, a touch wider than the ridge for self-centring
  const grooveTipW = wr + 0.3; // narrows with depth
  const lipMin = Math.max(1.0, p.wall * 0.4); // solid outer lip we aim to keep on the bed
  const maxInset = Math.max(p.wall / 2 - wr / 2 + 0.3, 0); // keep the shifted ridge ~on the wall top
  const inset = stack ? Math.min(Math.max(lipMin - (p.wall - grooveMouthW) / 2, 0), maxInset) : 0;
  const rW = cW - 2 * inset; // ridge/groove ring, shifted inboard for the bed lip
  const rL = cL - 2 * inset;
  const rr = Math.max(cr - inset, 0.5);

  // Chamfered stacking ridge: tapers from full width at the wall top to a narrow tip — it self-
  // centres into the groove and prints as a self-supporting peak. Built as a full loop; the front
  // segment is removed with the front opening below, unless the front is a full closed wall.
  if (stack) {
    tray = s.add(tray, taperedRing(s, rW, rL, rr, wr, wr * 0.3, H - 0.1, hr + 0.1, 6, open));
  }

  // Open the front — skipped entirely for a full closed front (lip at the wall top), which then keeps
  // its ridge like the other three walls. With a partial lip we clear the wall above the lip and leave
  // the floor under it; fully open (lip = 0) the cut goes through the floor too, so the base ends at the
  // opening instead of leaving a bare floor lip jutting out under the overhanging sheet.
  if (!frontClosed) {
    const cutLow = open ? -1 : p.floor + frontLip;
    const cutHigh = H + hr + 2;
    tray = s.sub(
      tray,
      s.move(
        s.box(outerW + 4, p.wall + 4, cutHigh - cutLow),
        0,
        -outerL / 2 + p.wall / 2,
        (cutLow + cutHigh) / 2,
      ),
    );
  }

  // Chamfered groove in the floor underside: a funnel mouth at the bottom face narrowing inward, so
  // the ridge above drops in and self-centres (self-supporting, no bridge). Inset with the ridge so
  // its outer wall leaves a solid, bed-adhering lip instead of a thin sliver.
  if (stack) {
    const gDepth = hr + 0.4;
    let groove = taperedRing(s, rW, rL, rr, grooveMouthW, grooveTipW, -0.1, gDepth + 0.1, 6, open);
    // Drop the groove's front segment whenever the ridge loses its (i.e. the front isn't a full wall),
    // so the two always match — both present on a closed front, neither on an open/partial one.
    if (!frontClosed) {
      groove = s.sub(
        groove,
        s.move(s.box(outerW + 4, p.wall + 4, gDepth + 4), 0, -outerL / 2 + p.wall / 2, gDepth / 2),
      );
    }
    tray = s.sub(tray, groove);
  }

  tray = applyPatterns(s, p, tray, d);
  // Scoop last, so it also cuts through any re-added perforated floor panel — the grab notch always
  // goes clean through the floor, whatever the floor style.
  tray = cutScoop(s, p, tray, d, frontLip);
  tray = addLabelRails(s, p, tray);

  const geom = s.finish(tray);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}
