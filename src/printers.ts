// Bambu Lab bed compatibility. Kept separate from the geometry/params so the printer table can grow
// without touching the modeller. Models that share a bed are grouped into one entry; dimensions are
// the single-nozzle horizontal printable area (a flat tray prints in one material), from Bambu's
// tech specs / wiki. A part may rotate 90°, so it fits if its long/short sides clear the bed's
// long/short sides.

const EXCLUSION_WIKI = "https://wiki.bambulab.com/en/knowledge-sharing/print-volume-limitations";

// Some beds can't use their full advertised size out of the box: the P1/X1 series reserve an
// 18×28 mm front-left corner for the AMS filament cutter's foldable stopper. Reaching it needs a
// small printed stopper-block plus a Bambu Studio preset change (see the wiki).
export type Mod = {
  ex: number; // unusable corner width (mm, along bed X)
  ey: number; // unusable corner depth (mm, along bed Y)
  note: string;
  url: string;
};

export type Printer = {
  name: string; // group label shown on the badge
  members?: string[]; // models in this group (shown in the tooltip)
  w: number; // full printable area, bed X (mm)
  d: number; // full printable area, bed Y (mm)
  mod?: Mod; // present when the full bed needs a modification
};

export const PRINTERS: Printer[] = [
  { name: "A1 mini", w: 180, d: 180 },
  { name: "A1", w: 256, d: 256 },
  {
    name: "P1 / X1",
    members: ["P1P", "P1S", "X1C"],
    w: 256,
    d: 256,
    mod: {
      ex: 18,
      ey: 28,
      note: "Full 256×256 bed needs the filament-cutter exclusion-zone mod",
      url: EXCLUSION_WIKI,
    },
  },
  { name: "H2D", w: 325, d: 320 },
  { name: "H2C", w: 330, d: 320 },
  { name: "H2S", w: 340, d: 320 },
];

export type Fit = "ok" | "mod" | "no";

// "ok": fits the guaranteed-usable area. "mod": fits the full bed but only if the exclusion-zone mod
// is applied. "no": too big even for the full bed. A centred part only collides with the front-left
// corner when it reaches into both the ex-wide and ey-deep strips at once, so a short part can still
// be "ok" on a mod printer.
export function fitFor(p: Printer, longSide: number, shortSide: number): Fit {
  const orients: [number, number][] = [
    [longSide, shortSide],
    [shortSide, longSide],
  ];
  let fitsBed = false;
  let clean = false;
  for (const [px, py] of orients) {
    if (px > p.w || py > p.d) continue;
    fitsBed = true;
    const hitsCorner = !!p.mod && px > p.w - 2 * p.mod.ex && py > p.d - 2 * p.mod.ey;
    if (!hitsCorner) clean = true;
  }
  if (clean) return "ok";
  if (fitsBed) return "mod";
  return "no";
}

// Tooltip text for a badge given its fit verdict.
export function fitTitle(p: Printer, fit: Fit): string {
  const who = p.members ? p.members.join(" · ") : p.name;
  const size = `${p.w} × ${p.d} mm`;
  if (fit === "no") return `${who}: ${size} — too big`;
  if (fit === "mod" && p.mod) return `${who}: ${size} — fits only with the mod. ${p.mod.note}.`;
  return `${who}: ${size} — fits`;
}
