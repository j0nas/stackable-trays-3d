// The text readout under the panel: footprint, item coverage, filament estimate, and the Bambu Lab
// bed-fit badges. Fed the live mesh geometry so the weight tracks whatever pattern is cut.

import type { BufferGeometry } from "three";
import type { Params } from "../params.ts";
import { caveatOf, fitFor, fitTitle, PRINTERS } from "../printers.ts";

const DENSITY: Record<string, number> = { PLA: 1.24, PETG: 1.27, ABS: 1.04, TPU: 1.21 }; // g/cm^3
const FILAMENT_AREA_MM2 = Math.PI * (1.75 / 2) ** 2; // cross-section of 1.75mm filament

// Solid volume of the mesh (cm^3) via the signed-tetrahedron sum (divergence theorem). three.js has
// no built-in mesh-volume helper, and this is the standard, robust way for a closed mesh; it stays
// stable through the CSG T-junctions, so it's our source of truth for the filament estimate.
function meshVolumeCm3(g: BufferGeometry): number {
  const pos = g.getAttribute("position");
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  let v = 0;
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    const ax = pos.getX(a),
      ay = pos.getY(a),
      az = pos.getZ(a);
    const bx = pos.getX(b),
      by = pos.getY(b),
      bz = pos.getZ(b);
    const cx = pos.getX(c),
      cy = pos.getY(c),
      cz = pos.getZ(c);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v) / 1000;
}

// True printed footprint (mm) from the mesh bounds, so it counts the label rail (and anything else
// bolted onto the body) — not just the nominal wall box from dims(). The body is centred on the X/Y
// origin, so each span is simply max − min along that axis.
function footprintMm(g: BufferGeometry): { w: number; l: number } {
  g.computeBoundingBox();
  const bb = g.boundingBox;
  if (!bb) return { w: 0, l: 0 };
  return { w: bb.max.x - bb.min.x, l: bb.max.y - bb.min.y };
}

export type ReadoutEls = {
  dimsEl: HTMLElement;
  fitsEl: HTMLElement;
  legendEl: HTMLElement;
  materialSel: HTMLSelectElement;
  getGeometry: () => BufferGeometry;
};

export function createReadout(els: ReadoutEls): (params: Params) => void {
  return function update(params: Params): void {
    const geom = els.getGeometry();
    const fp = footprintMm(geom); // real bounds (includes the label rail), not the nominal wall box
    const long = Math.max(fp.w, fp.l);
    const short = Math.min(fp.w, fp.l);
    const held = Math.round(((params.itemLength - params.frontOverhang) / params.itemLength) * 100);
    const mat = els.materialSel.value;
    const volCm3 = meshVolumeCm3(geom);
    const grams = Math.round(volCm3 * (DENSITY[mat] ?? 1.24));
    const metres = volCm3 / FILAMENT_AREA_MM2; // cm^3 -> mm^3 (x1000) -> length (/area, /1000) cancel
    els.dimsEl.textContent = `${fp.w.toFixed(0)} × ${fp.l.toFixed(0)} mm · holds ${held}% of item · ≈ ${grams} g · ${metres.toFixed(0)} m ${mat} (solid)`;

    // Compatibility badges (part may rotate 90°). Amber = fits the bed but only with a caveat: the
    // P1/X1 exclusion-zone mod, or single-nozzle-only on the dual-nozzle H2D/H2C. The legend below
    // explains each active caveat (deduped) and links to the relevant Bambu wiki page.
    els.fitsEl.replaceChildren();
    const caveats = new Map<string, string>(); // note -> url, deduped across amber printers
    for (const pr of PRINTERS) {
      const fit = fitFor(pr, long, short);
      if (fit === "mod") {
        const c = caveatOf(pr);
        if (c) caveats.set(c.note, c.url);
      }
      const badge = document.createElement("span");
      badge.className = `fit ${fit}`;
      badge.textContent = pr.name;
      badge.title = fitTitle(pr, fit);
      els.fitsEl.append(badge);
    }

    els.legendEl.replaceChildren();
    for (const [note, url] of caveats) {
      const line = document.createElement("div");
      line.className = "legend-line";
      const sw = document.createElement("span");
      sw.className = "swatch";
      line.append(sw, document.createTextNode(` ${note}`));
      if (url) {
        line.append(document.createTextNode(" · "));
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "details";
        line.append(a);
      }
      els.legendEl.append(line);
    }
    els.legendEl.style.display = caveats.size > 0 ? "flex" : "none";
  };
}
