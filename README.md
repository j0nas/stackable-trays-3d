# stackable-trays

Parametric, open-front, **stackable trays** for FDM 3D printing — **A4 paper by default**, but sized
for any item (photos, cards, envelopes, …) via item dimensions or one-click presets. Tune everything
with sliders, watch the model and the filament estimate update live, then export a print-ready STL.
The preview and the STL come from the _same_ geometry, so the print matches what you see.

![Preview](docs/preview.png)

## Why

A 3D-printed alternative to the laser-cut plywood version — better looking, lighter, and it
nests. The front is always open so the contents stay reachable while stacked. By default the tray
fully holds the item; turning up the **front overhang** lets the item jut out the open front so you
can grab it (the original A4 letter-tray style), which also shrinks the footprint to fit smaller beds.

## What you get

- **Any item** — set **item width × length** directly, or pick a **preset** (A4, US Letter, A5,
  postcard, 4×6 photo, index card, #10 envelope, business card). **Clearance** is one uniform fit gap
  applied to every enclosing wall.
- **Front overhang** — `frontOverhang` sets how far the item sticks out the open front. At `0`
  (**the default**) the item is fully enclosed and the front earns its own clearance like the sides and
  back; turn it up and the item overhangs (the A4 letter-tray feel, e.g. ~20% out) so you can grab it
  while stacked, which also shrinks the footprint to fit smaller beds. Picking an item preset resets
  this to `0`, so a preset always yields a tray that fully holds that item.
- **Adjustable front lip** — independent of the overhang (this is vertical): the lip slider runs from
  `0` (open top: no front wall, and the floor under it removed for tighter bed fitment), through a low
  bump-stop lip, up to the **wall height** for a fully closed front that keeps its stacking ridge like
  the other three walls. The slider is capped at the current wall height. A tall enough lip (or a fully
  closed front) carries the same lightening pattern as the other three walls; a short lip stays solid.
- **Front scoop** (optional) — a central grab cutout on the front edge, so you can still pull a
  sheet out of a tightly stacked middle tray. Adjustable width _and_ depth; it dips any front lip
  down to the floor and bites back into the floor edge, so it helps whether the front is open or
  closed. Its corners follow the corner-radius setting.
- **Swappable label** (optional) — a slim **dovetail rail** at a front-bottom corner (**left, right,
  or both**), anchored to the floor so it stays attached whether the front is open or closed. A small
  printed clip slides down onto the dovetail and bottoms on a stop; it has a top-loading pocket, so you
  relabel forever by swapping a paper card or moving the clip — nothing about the paper type is baked
  into the tray. The rail projects forward and sits low, well clear of the tray stacked above.
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

Grouped in the panel: **Size & fit** (item preset, item width + length, clearance, front overhang,
front lip, front scoop width + depth) · **Walls** (height, thickness, corner radius, style, pattern
size + margin) · **Floor** (thickness, style, pattern size + margin) · **Stacking** (ridge
height/width, on/off) · **Label** (clip rail side + clip export) · **View & output** (material, show
item, show stack). Walls and floor each have their own pattern size and margin so you can tune them
independently; the margin is the solid border width and reads the same on the walls and the floor.

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
  tray builds its dovetail rail from, so the two always mate.
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
