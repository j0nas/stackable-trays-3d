// The removable label clip — a separate little part that snaps onto the front-top rail of a tray
// (added when params.labelRail is on; see tray.ts). It carries a top-loading pocket for a paper card,
// so ONE printed clip relabels forever: write/print a new card and swap it, or move the whole clip to
// another tray. Nothing about the paper type is baked into the tray.
//
// The mount is a T-rail: a stem off the side wall carrying a wider head, so the clip's channel grips
// the head and can't pull off forward. The clip slides on from the top and bottoms out on a stop.
// Built Z-up in "use" orientation (origin = head centre, card facing −Y, channel opening +Y) so the
// viewer can drop it straight onto the rail. Every face is a vertical extrusion or a flat ledge, so
// it's already base-down and exports ready to print flat with no supports.
//
// RAIL is the single source of truth for the mount dimensions — tray.ts imports it to build the rail,
// so the two parts always match.

import type { BufferGeometry } from "three";
import { scope } from "./csg.ts";

export const RAIL = {
  len: 20, // vertical grip length (tray.ts clamps the rail to the wall height)
  stemW: 3, // neck width (X) tying the head to the wall
  stemY: 2.6, // neck depth (Y) — the gap the clip's rear hooks reach into
  headW: 9, // head width (X), wider than the stem so the clip is captured in −Y
  headT: 3, // head thickness (Y)
};

// Clearance on every clip-vs-rail face. THE one number to tweak if the clip is too tight or too
// loose on your printer — bigger = looser. ~0.35 mm suits a well-tuned Bambu in PLA/PETG.
const FIT = 0.35;

export function buildLabelClip(): BufferGeometry {
  const { stemW, headW, headT, len } = RAIL;
  const s = scope();

  // --- channel that grips the head (origin at head centre; +Y points back toward the wall) --------
  const wall = 2; // side wall thickness of the channel
  const front = 2.5; // wall in front of the head (the card plate mounts on this)
  const back = 2; // rear wall — slotted to leave two hooks that capture the head
  const stop = 2.5; // closed bottom so the clip seats instead of sliding through
  const clipH = len + 1;

  const outerX = headW + 2 * FIT + 2 * wall;
  const outerY = headT + 2 * FIT + front + back;
  const cy = (back - front) / 2; // head centre is y = 0; centre the block around it
  let body = s.move(s.box(outerX, outerY, clipH), 0, cy, 0);

  // head cavity: open at the top to slide on, closed at the bottom by `stop`
  body = s.sub(body, s.move(s.box(headW + 2 * FIT, headT + 2 * FIT, clipH), 0, 0, stop));
  // rear slot: removes the back-wall centre so only two side hooks remain to capture the head; the
  // stem passes through this gap
  body = s.sub(
    body,
    s.move(s.box(stemW + 2 * FIT, back + 1, clipH + 2), 0, headT / 2 + FIT + back / 2, 0),
  );

  // --- front card holder: backing plate + a top-loading pocket behind a thin retaining lip --------
  const cardW = 40;
  const cardH = 14; // visible card window
  const lip = 1.4; // how far the front lip overlaps the card edge (and the border width)
  const plate = 1.2; // backing plate thickness
  const gap = 1.0; // pocket depth — card slides into this
  const lipT = 1.0; // front lip thickness
  const fW = cardW + 2 * lip; // outer plate width
  const y0 = -(headT / 2 + FIT + front); // front face of the channel
  // The plate runs from the clip's base (so the whole part sits flat on the bed and prints without
  // support) up to just above the card window.
  const plateBot = -clipH / 2;
  const plateTop = cardH / 2 + lip;
  const plateH = plateTop - plateBot;
  const plateZ = (plateTop + plateBot) / 2;

  // Each box overlaps the one behind it by `weld` so the whole clip fuses into a single solid (boxes
  // that merely touch at a coincident face stay separate shells — they'd print as loose pieces).
  const weld = 0.4;
  body = s.add(body, s.move(s.box(fW, plate + weld, plateH), 0, y0 - plate / 2 + weld / 2, plateZ)); // backing plate (welds into the channel)
  body = s.add(
    body,
    s.move(
      s.box(fW, gap + lipT + weld, plateH),
      0,
      y0 - plate - (gap + lipT) / 2 + weld / 2,
      plateZ,
    ),
  ); // front block (welds into the plate)

  // Carve the pocket (depth `gap`) then a smaller window through the front lip so the card shows,
  // leaving a `lip`-wide border on the sides and bottom. Both cuts are anchored at the card's bottom
  // and run well off the top edge, so the card loads from the top and rests on the bottom border.
  const tall = clipH + cardH; // taller than the plate so the cut clears the open top edge
  body = s.sub(
    body,
    s.move(s.box(cardW, gap + 0.2, tall), 0, y0 - plate - gap / 2, -cardH / 2 + tall / 2),
  );
  body = s.sub(
    body,
    s.move(
      s.box(cardW - 2 * lip, lipT + 0.2, tall),
      0,
      y0 - plate - gap - lipT / 2,
      -cardH / 2 + lip + tall / 2,
    ),
  );

  const geom = s.finish(body);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}
