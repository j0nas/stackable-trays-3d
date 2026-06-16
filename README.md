# a4-stackable-trays

Parametric, open-front, **stackable A4 paper trays** for FDM 3D printing. Tune everything with
sliders, watch the model and the filament estimate update live, then export a print-ready STL.
The preview and the STL come from the *same* geometry, so the print matches what you see.

![Preview](docs/preview.png)

## Why

A 3D-printed alternative to the laser-cut plywood version — better looking, lighter, and it
nests. Trays hold ~80% of the sheet and leave the front open, so paper overhangs where you grab
it and stays reachable while stacked. Holding only part of the sheet also shrinks the footprint
so it fits smaller beds.

## What you get

- **Open front** — sheet overhangs and stays accessible while stacked (`Front lip = 0` removes
  the front wall *and* the floor under it, for tighter bed fitment).
- **Stackable** — a chamfered ridge on the wall tops drops into a funnel groove in the floor
  above, so trays self-register when nested. Both are tapered to print without support.
- **7 wall + floor styles** — solid, louvres, grid, holes, diamond, honeycomb, voronoi — to cut
  weight and filament. A honeycomb wall+floor roughly halves the mass.
- **Live filament estimate** in grams (PLA / PETG / ABS / TPU).
- **Bambu Lab fit badges** — shows at a glance which beds the current footprint fits
  (A1 mini · A1 · P1P · P1S · X1C · H2D · H2S · H2C), accounting for 90° rotation.
- **One-click binary STL export.**

## Run

```bash
vp install      # or: pnpm install
vp dev          # http://localhost:5173
vp build        # production build
vp check        # format + lint + typecheck
```

## Controls

Grouped in the panel: **Size & fit** (depth, clearance, wall height, front lip) ·
**Walls & base** (thicknesses, corner radius) · **Pattern** (margin + wall/floor style) ·
**Stacking** (ridge height/width, on/off) · **View & output** (material, show sheet, show stack).

## How it works

- `src/params.ts` — pure parameter types, defaults, derived dimensions, and the Bambu bed table.
- `src/tray.ts` — `Params → one watertight BufferGeometry`. Built with [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg)
  booleans (manifold output), modelled **Z-up, base on z = 0, millimetres** (slicer convention).
- `src/viewer/main.ts` — Three.js scene, sliders, live readout, and the STL exporter.

## Printing

Print **base-down, no supports**. Every opening is vertical or cellular so its top only bridges a
short span; honeycomb/diamond/holes are self-supporting, and the stacking ridge/groove are tapered.
Floor patterns are vertical through-holes in a flat plate, so they need no bridging.

## Stack

Vanilla TypeScript + [Vite+](https://viteplus.dev) · Three.js · three-bvh-csg · d3-delaunay (voronoi).
