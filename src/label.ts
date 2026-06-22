// The removable label clip — a separate little part that slides onto a tray's front dovetail rail
// (added when params.labelRail is on; see tray.ts). It carries a top-loading pocket for a paper card,
// so ONE printed clip relabels forever: write/print a new card and swap it, or move the whole clip to
// another tray. Nothing about the paper type is baked into the tray.
//
// The mount is a TAPERED DOVETAIL: the tray carries a trapezoidal rib that flares wider toward the
// front (the undercut) AND wider toward the bottom (the taper). The clip has the matching tapered
// socket and drops on from the top; the rib widens as the clip descends, so it wedges to a stop with no
// skirt on the clip — the taper IS the stop. The undercut still captures it forward. Because the rib
// is widest at the bed and only drafts inward going up, it prints with no supports, and it extends all
// the way down to z = 0 instead of cantilevering off the floor with an unsupported underside.
// Built Z-up in "use" orientation (origin = the seat where the socket bottoms on the rail, at the
// tray's front face; +Y into the tray, card facing −Y) so the viewer can drop it straight onto the
// rail. The socket drafts only ~5° from vertical, so the clip is still base-down printable.
//
// RAIL is the single source of truth for the mount dimensions — tray.ts imports it to build the rib,
// so the two parts always match.

import type { BufferGeometry } from "three";
import { scope } from "./csg.ts";
import { dovetailShape } from "./shapes.ts";

export const RAIL = {
  len: 20, // clip grip length (the socket height); tray.ts clamps the rail to the wall depth
  neckW: 5, // NOMINAL dovetail width (X) at the neck — the size at the clip's seat (one `len` below the top)
  tipW: 9, // NOMINAL dovetail width (X) at the flared front tip — wider than the neck so the clip can't pull off
  projY: 4.5, // NOMINAL forward (−Y) projection of the dovetail at the seat
  topScale: 0.62, // dovetail scale at the rail top (narrowest); 1.0 at the seat, > 1 below it toward the bed
};

// Clearance on every clip-vs-rail face. THE one number to tweak if the clip is too tight or too
// loose on your printer — bigger = looser. ~0.35 mm suits a well-tuned Bambu in PLA/PETG.
const FIT = 0.35;

// The rail tapers linearly with height: nominal (scale 1.0) at the seat — `len` below the top — and
// `topScale` at the top, so it keeps narrowing the same amount per mm all the way down to the bed.
// Given the rail's total height (z = 0 .. railTop) this returns the bottom scale and the relative
// top-scale to pass to extrude, plus the widest tip width (at the bed, for the placement clamp) and the
// seat height where the clip lands. Depends only on RAIL, so the single printed clip fits any depth.
export function railTaper(railTop: number): {
  baseScale: number; // scale at z = 0 (widest, on the bed)
  scaleTopRel: number; // extrude top scale relative to the z = 0 base
  widestTipW: number; // tip width at the bed
  seatZ: number; // z where the rail reaches nominal size — the clip's socket bottom rests here
} {
  const a = (1 - RAIL.topScale) / RAIL.len; // scale lost per mm going up
  const baseScale = RAIL.topScale + a * railTop;
  return {
    baseScale,
    scaleTopRel: RAIL.topScale / baseScale,
    widestTipW: RAIL.tipW * baseScale,
    seatZ: railTop - RAIL.len,
  };
}

export function buildLabelClip(): BufferGeometry {
  const { neckW, tipW, projY, len, topScale } = RAIL;
  const s = scope();

  // Origin is the SEAT (z = 0): the rail is nominal size here, so the socket bottom rests on it. The
  // socket runs straight through — no skirt — and the clip slides down from the rail's narrow top until
  // the widening rail wedges it at the seat. +Y into the tray, −Y forward, card facing −Y. The rail's
  // neck pokes out the open back face (the mouth) while the wider tip is captured by the side arms.
  const sw = 2.0; // side-arm wall thickness around the dovetail
  const fw = 2.6; // front wall ahead of the tip (the card plate mounts on it)
  const clipH = len; // socket height == the rail's grip length
  const zc = clipH / 2; // block spans z = 0 .. clipH

  const outerX = tipW + 2 * FIT + 2 * sw; // covers the widest socket (its bed-level bottom)
  const blockFront = -(projY + FIT + fw); // most −Y face; the block back sits at y = 0 (the tray face)
  let body = s.move(s.box(outerX, -blockFront, clipH), 0, blockFront / 2, zc);

  // Carve the socket: the rail's trapezoid + FIT clearance at the seat, tapering up by the rail's
  // `topScale` so it mates the taper along the whole grip and wedges to a stop (the clip needs no
  // bottom). anchorNeck keeps the neck on the back plane as the socket scales about the origin. Run it a
  // hair past both ends so it's an open sleeve, and shift the neck to y = +FIT to clear the rail neck.
  let sock = s.extrude(
    dovetailShape(neckW + 2 * FIT, tipW + 2 * FIT, projY + 2 * FIT, true),
    clipH + 1,
    12,
    {
      x: topScale,
      y: topScale,
    },
  );
  sock = s.move(sock, 0, FIT, -0.5);
  body = s.sub(body, sock);

  // --- front card holder: backing plate + a top-loading pocket behind a thin retaining lip --------
  const cardW = 38; // visible card width
  const cardH = 15; // visible card window height
  const lip = 1.6; // how far the front lip overlaps the card edge (and the border width)
  const plate = 1.2; // backing plate thickness
  const gap = 1.0; // pocket depth — card slides into this
  const lipT = 1.0; // front lip thickness
  const fW = cardW + 2 * lip; // outer plate width
  const y0 = blockFront; // front face of the socket block; the plate hangs off it

  // Each box overlaps the one behind it by `weld` so the whole clip fuses into a single solid (boxes
  // that merely touch at a coincident face stay separate shells — they'd print as loose pieces).
  const weld = 0.4;
  body = s.add(body, s.move(s.box(fW, plate + weld, clipH), 0, y0 - plate / 2 + weld / 2, zc)); // backing plate (welds into the block)
  body = s.add(
    body,
    s.move(s.box(fW, gap + lipT + weld, clipH), 0, y0 - plate - (gap + lipT) / 2 + weld / 2, zc),
  ); // front block (welds into the plate)

  // Carve the pocket (depth `gap`) then a smaller window through the front lip so the card shows,
  // leaving a `lip`-wide border on the sides and bottom. Both cuts are anchored at the card's bottom
  // and run well off the top edge, so the card loads from the top and rests on the bottom border.
  const cardBot = (clipH - cardH) / 2; // centre the card window vertically in the clip
  const tall = clipH + cardH; // taller than the clip so the cut clears the open top edge
  body = s.sub(
    body,
    s.move(s.box(cardW, gap + 0.2, tall), 0, y0 - plate - gap / 2, cardBot + tall / 2),
  );
  body = s.sub(
    body,
    s.move(
      s.box(cardW - 2 * lip, lipT + 0.2, tall),
      0,
      y0 - plate - gap - lipT / 2,
      cardBot + lip + tall / 2,
    ),
  );

  const geom = s.finish(body);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}
