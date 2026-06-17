# a4-stackable-trays

Parametric, open-front, **stackable A4 paper trays** for FDM 3D printing. Tune everything with
sliders, watch the model and the filament estimate update live, then export a print-ready STL.
The preview and the STL come from the _same_ geometry, so the print matches what you see.

![Preview](docs/preview.png)

## Why

A 3D-printed alternative to the laser-cut plywood version — better looking, lighter, and it
nests. Trays hold ~80% of the sheet and leave the front open, so paper overhangs where you grab
it and stays reachable while stacked. Holding only part of the sheet also shrinks the footprint
so it fits smaller beds.

## What you get

- **Adjustable front** — the front-lip slider runs from `0` (fully open: no front wall, and the
  floor under it removed for tighter bed fitment), through a low bump-stop lip, up to the **wall
  height** for a fully closed front that keeps its stacking ridge like the other three walls. The
  slider is capped at the current wall height.
- **Front scoop** (optional) — a central grab cutout on the front edge, so you can still pull a
  sheet out of a tightly stacked middle tray. Adjustable width _and_ depth; it dips any front lip
  down to the floor and bites back into the floor edge, so it helps whether the front is open or
  closed. Its corners follow the corner-radius setting.
- **Swappable label** (optional) — a clip rail at a front-bottom corner (**left, right, or both**),
  anchored to the floor so it stays attached whether the front is open or closed. It takes a small
  printed clip with a top-loading pocket: drop a paper card in, snap the clip on, and relabel forever
  by swapping the card or moving the clip — nothing about the paper type is baked into the tray.
- **Stackable** — a chamfered ridge on the wall tops drops into a funnel groove in the floor
  above, so trays self-register when nested. Both are tapered to print without support.
- **7 wall + floor styles** — solid, louvres, grid, holes, diamond, honeycomb, voronoi — to cut
  weight and filament. A honeycomb wall+floor roughly halves the mass.
- **Live filament estimate** in grams and metres of 1.75 mm filament (PLA / PETG / ABS / TPU).
- **Bambu Lab fit badges** — shows at a glance which beds the current footprint fits
  (A1 mini · A1/X2D · P1/P2/X1 · H2D/H2C · A2L · H2S — current 2026 lineup, grouped by bed),
  accounting for 90° rotation. Amber means it fits only with the P1/P2/X1 filament-cutter
  [exclusion-zone mod](https://wiki.bambulab.com/en/knowledge-sharing/print-volume-limitations).
- **One-click binary STL export** — the tray, and (when the label rail is on) the clip as its own
  print-ready STL.

## Run

```bash
vp install      # or: pnpm install
vp dev          # http://localhost:5173
vp build        # production build
vp check        # format + lint + typecheck
```

## Controls

Grouped in the panel: **Size & fit** (footprint, clearance, front lip, front scoop width + depth) ·
**Walls** (height, thickness, corner radius, style, pattern size + margin) ·
**Floor** (thickness, style, pattern size + margin) · **Stacking** (ridge height/width, on/off) ·
**Label** (clip rail side + clip export) · **View & output** (material, show sheet, show stack).
Walls and floor each have their own pattern size and margin, since the same margin reads very
differently on a tall wall vs. the flat base.

## How it works

- `src/params.ts` — pure parameter types, defaults, and derived dimensions.
- `src/printers.ts` — Bambu bed table (grouped by size) and the bed-fit / exclusion-zone-mod logic.
- `src/csg.ts` — the solid-modelling layer: 2D profiles extruded and boolean'd through
  [manifold-3d](https://github.com/elalish/manifold) (Google's Manifold kernel — the engine modern
  OpenSCAD uses), which **guarantees watertight, 2-manifold output** so the STL slices cleanly.
- `src/shapes.ts` — reusable 2D profiles (rounded rects, rings, polygons, perforated panels).
- `src/patterns.ts` — the wall/floor lightening patterns (louvres, grid, holes, diamond, honeycomb,
  voronoi) as 2D cell sets.
- `src/tray.ts` — the assembly: `Params → one watertight BufferGeometry`, modelled **Z-up, base on
  z = 0, millimetres** (slicer convention). Reads as a pipeline — body, stacking ridge, front
  opening, scoop, groove, patterns, label rails.
- `src/label.ts` — the removable label clip (a separate part) and the shared `RAIL` dimensions the
  tray builds its snap-rail from, so the two always mate.
- `src/viewer/` — `main.ts` wires it together; `scene.ts` (renderer/camera/lights, renders on
  demand), `readout.ts` (volume estimate + fit badges), `controls.ts` (the slider panel), and
  `storage.ts` (localStorage persistence).

Your settings are saved in the browser and restored on the next visit; **Reset to defaults** clears
them.

## Printing

Print **base-down, no supports**. Every opening is vertical or cellular so its top only bridges a
short span; honeycomb/diamond/holes are self-supporting, and the stacking ridge/groove are tapered.
Floor patterns are vertical through-holes in a flat plate, so they need no bridging.

The **label clip** also prints flat, base-down, no supports — slide a paper card in from the top. If
it grips the rail too tightly or too loosely, tweak the single `FIT` clearance in `src/label.ts`
(bigger = looser; ~0.35 mm suits a well-tuned Bambu).

## Stack

Vanilla TypeScript + [Vite+](https://viteplus.dev) · Three.js · manifold-3d (WASM CSG) · d3-delaunay (voronoi).
