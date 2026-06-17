// The text readout under the panel: footprint, A4 coverage, filament estimate, and the Bambu Lab
// bed-fit badges. Fed the live mesh geometry so the weight tracks whatever pattern is cut.

import type { BufferGeometry } from "three";
import { dims, type Params } from "../params.ts";
import { fitFor, fitTitle, PRINTERS } from "../printers.ts";

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

export type ReadoutEls = {
  dimsEl: HTMLElement;
  fitsEl: HTMLElement;
  legendEl: HTMLElement;
  materialSel: HTMLSelectElement;
  getGeometry: () => BufferGeometry;
};

export function createReadout(els: ReadoutEls): (params: Params) => void {
  return function update(params: Params): void {
    const d = dims(params);
    const long = Math.max(d.outerW, d.outerL);
    const short = Math.min(d.outerW, d.outerL);
    const pct = Math.round((params.capture / params.a4Length) * 100);
    const mat = els.materialSel.value;
    const volCm3 = meshVolumeCm3(els.getGeometry());
    const grams = Math.round(volCm3 * (DENSITY[mat] ?? 1.24));
    const metres = volCm3 / FILAMENT_AREA_MM2; // cm^3 -> mm^3 (x1000) -> length (/area, /1000) cancel
    els.dimsEl.textContent = `${d.outerW.toFixed(0)} × ${d.outerL.toFixed(0)} mm · holds ${pct}% of A4 · ≈ ${grams} g · ${metres.toFixed(0)} m ${mat} (solid)`;

    // Compatibility badges (part may rotate 90°). Amber = fits the bed but only with the P1/X1
    // exclusion-zone mod; the legend below appears only then and links to the Bambu wiki.
    els.fitsEl.replaceChildren();
    let modUrl = "";
    for (const pr of PRINTERS) {
      const fit = fitFor(pr, long, short);
      if (fit === "mod" && pr.mod) modUrl = pr.mod.url;
      const badge = document.createElement("span");
      badge.className = `fit ${fit}`;
      badge.textContent = pr.name;
      badge.title = fitTitle(pr, fit);
      els.fitsEl.append(badge);
    }
    if (modUrl) {
      els.legendEl.innerHTML = `<span class="swatch"></span> needs a <a href="${modUrl}" target="_blank" rel="noopener">bed mod</a> for full size`;
      els.legendEl.style.display = "flex";
    } else {
      els.legendEl.style.display = "none";
    }
  };
}
