// The removable label clip — a separate little part that slides onto a tray's front dovetail rail
// (added when params.labelRail is on; see tray.ts). It carries a top-loading pocket for a paper card,
// so ONE printed clip relabels forever: write/print a new card and swap it, or move the whole clip to
// another tray. Nothing about the paper type is baked into the tray.
//
// The mount is a DOVETAIL: the tray carries a trapezoidal rib that flares wider toward the front, and
// the clip has the matching socket. The clip drops on from the top and bottoms out on an internal
// stop; the flared rib can't pull back through the narrower socket mouth, so it's captured forward.
// Built Z-up in "use" orientation (origin = bottom-centre, at the tray's front face; +Y into the tray,
// card facing −Y) so the viewer can drop it straight onto the rail. Every face is a vertical extrusion
// or a flat ledge, so it's already base-down and exports ready to print flat with no supports.
//
// RAIL is the single source of truth for the mount dimensions — tray.ts imports it to build the rib,
// so the two parts always match.

import type { BufferGeometry } from "three";
import { scope } from "./csg.ts";
import { dovetailShape } from "./shapes.ts";

export const RAIL = {
  len: 20, // vertical slide length (tray.ts clamps the rail to the wall depth)
  neckW: 5, // dovetail width (X) at the neck, where the rib meets the tray
  tipW: 9, // dovetail width (X) at the flared front tip — wider than the neck so the clip can't pull off
  projY: 4.5, // how far the dovetail projects forward (−Y) from the tray's front face
};

// Clearance on every clip-vs-rail face. THE one number to tweak if the clip is too tight or too
// loose on your printer — bigger = looser. ~0.35 mm suits a well-tuned Bambu in PLA/PETG.
const FIT = 0.35;

export function buildLabelClip(): BufferGeometry {
  const { neckW, tipW, projY, len } = RAIL;
  const s = scope();

  // Origin is the SEAT plane (z = 0): where the clip bottoms out on the rib's shoulder (the rib's
  // dovetail flare sits z = 0 .. len; below z = 0 the rib is just a thin neck welded into the tray, so
  // the clip's `stop` lands on the flare's underside). +Y points into the tray, −Y forward, card facing
  // −Y. The socket cavity opens at the top to slide on; the rib's narrow neck pokes out the open back
  // face (the mouth) while the wider tip is captured by the side arms — that's the dovetail grip.
  const sw = 2.0; // side-arm wall thickness around the dovetail
  const fw = 2.6; // front wall ahead of the tip (the card plate mounts on it)
  const stop = 2.5; // solid skirt below the seat so the clip bottoms on the rib shoulder
  const clipH = len + stop; // seat sits `stop` above the base; socket is `len` tall above the seat

  const outerX = tipW + 2 * FIT + 2 * sw;
  const blockFront = -(projY + FIT + fw); // most −Y face; the block back sits at y = 0 (the tray face)
  const zc = (len - stop) / 2; // block spans z = −stop .. len
  let body = s.move(s.box(outerX, -blockFront, clipH), 0, blockFront / 2, zc);

  // Carve the socket: the rib's trapezoid grown by FIT, neck edge at y = +FIT, extruded from the seat
  // (z = 0) up and off the top. Below the seat stays solid (the `stop` skirt), so the clip bottoms on
  // the rib's flare shoulder and the card sits at a repeatable height.
  let sock = s.extrude(dovetailShape(neckW + 2 * FIT, tipW + 2 * FIT, projY + 2 * FIT), len + 1);
  sock = s.move(sock, 0, -projY / 2, 0);
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
  const cardBot = -stop + (clipH - cardH) / 2; // centre the card window vertically in the clip
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
