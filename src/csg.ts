// CSG layer backed by manifold-3d (Google's Manifold kernel — the engine modern OpenSCAD uses).
//
// We previously used three-bvh-csg, but its output is not manifold: it leaves T-junctions on cut
// faces (a vertex landing mid-edge of the adjacent triangle), so even a trivial box−box came out with
// dozens of boundary edges that no amount of vertex-welding repairs. Slicers tried to fix it and
// rendered the model "broken" (Bambu Studio reported non-manifold edges). Manifold *guarantees*
// watertight, 2-manifold output, so the exported STL is clean and prints as previewed.
//
// We build entirely in Manifold space: 2D profiles come from three.js Shapes (convenient for the
// rounded rectangles and pattern cells), but they're extruded with Manifold's own CrossSection
// (Clipper2) rather than three's ExtrudeGeometry. That avoids two problems at once: ExtrudeGeometry's
// ear-clipping emits non-manifold triangulations for collinear/axis-aligned holes (louvres, grid,
// voronoi), and converting a three mesh back into a Manifold needs Manifold.Mesh.merge(), whose
// manifold-3d@3.5.1 binding leaks WASM memory on every call — fatal for a live slider that rebuilds
// dozens of times a second. Staying in Manifold the whole way sidesteps both. The only three.js
// conversion is the final Manifold -> BufferGeometry for rendering/STL.
//
// Manifold objects live in the WASM heap and are NOT garbage-collected — every intermediate must be
// .delete()d or memory grows per rebuild. `scope()` tracks every solid it creates and frees them all
// in finish(), so callers never juggle lifetimes.

import Module, { type Manifold } from "manifold-3d";
import { BufferAttribute, BufferGeometry, type Shape } from "three";

export type Solid = Manifold;

// A column-major 4×4 affine matrix (Manifold ignores the last row). Used to place wall panels with
// 90° axis swaps, for which Manifold has exact (rounding-free) code paths.
export type Mat = Parameters<Manifold["transform"]>[0];

let api: Awaited<ReturnType<typeof Module>> | null = null;

// Load + initialise the WASM module once. Must be awaited before any geometry is built. The browser
// entry (main.ts) passes the Vite-bundled wasm URL so the Emscripten loader can fetch it via
// locateFile; Node geometry tests call this with no argument and let the loader find the wasm next to
// its own module. Keeping the `?url` import out of this file leaves it importable under plain Node.
export async function initCSG(wasmUrl?: string): Promise<void> {
  if (api) return;
  const config = wasmUrl ? { locateFile: () => wasmUrl } : undefined;
  const wasm = await Module(config);
  wasm.setup();
  api = wasm;
}

function mf(): NonNullable<typeof api> {
  if (!api) throw new Error("initCSG() must be awaited before building tray geometry");
  return api;
}

// Manifold -> three.js BufferGeometry (positions + index; the caller computes normals). Data is copied
// out of WASM memory so the source Manifold can be safely deleted afterwards.
function toGeometry(man: Solid): BufferGeometry {
  const m = man.getMesh();
  const np = m.numProp;
  let pos: Float32Array;
  if (np === 3) {
    pos = new Float32Array(m.vertProperties);
  } else {
    const n = m.vertProperties.length / np;
    pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = m.vertProperties[i * np];
      pos[i * 3 + 1] = m.vertProperties[i * np + 1];
      pos[i * 3 + 2] = m.vertProperties[i * np + 2];
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(m.triVerts), 1));
  return g;
}

// A build scope. Every solid it produces is tracked and freed by finish(), so the WASM heap doesn't
// grow across rebuilds. Boolean/transform ops return fresh solids (Manifold is immutable) — those are
// tracked too, so the whole intermediate tree is reclaimed in one pass.
export type Scope = {
  // Extrude a 2D shape (with optional holes) up +Z (z = 0 .. height) as a manifold solid.
  extrude: (shape: Shape, height: number, curveSegments?: number) => Solid;
  box: (w: number, d: number, h: number) => Solid; // origin-centred box (matches BoxGeometry)
  union: (parts: Solid[]) => Solid; // merge many solids into one
  sub: (a: Solid, b: Solid) => Solid;
  add: (a: Solid, b: Solid) => Solid;
  intersect: (a: Solid, b: Solid) => Solid; // keep only the overlap (used to clip a panel to a footprint)
  move: (a: Solid, x: number, y: number, z: number) => Solid;
  transform: (a: Solid, m: Mat) => Solid; // affine placement (used for 90° wall swaps)
  finish: (final: Solid) => BufferGeometry; // extract geometry, then free everything tracked
};

export function scope(): Scope {
  const items: Solid[] = [];
  const keep = (s: Solid): Solid => {
    items.push(s);
    return s;
  };
  return {
    extrude: (shape, height, curveSegments = 12) => {
      const m = mf();
      const ring = (pts: { x: number; y: number }[]): [number, number][] =>
        pts.map((p) => [p.x, p.y]);
      const contours: [number, number][][] = [
        ring(shape.getPoints(curveSegments)),
        ...shape.holes.map((h) => ring(h.getPoints(curveSegments))),
      ];
      const cs = new m.CrossSection(contours, "EvenOdd"); // EvenOdd: nested contours read as holes
      // manifold-3d@3.5.1's CrossSection.extrude() builds a WASM polygon vector via _ToPolygons() and
      // never frees it — a per-call leak that's heavy for many-celled panels (honeycomb/holes). Drive
      // the lower-level _Extrude ourselves so we can delete that vector; fall back to the public
      // method if these internals ever change.
      const lower = cs as unknown as { _ToPolygons?: () => { delete: () => void } };
      const extrude = (m as unknown as { _Extrude?: (...a: unknown[]) => Solid })._Extrude;
      const polys = lower._ToPolygons?.();
      let man: Solid;
      if (polys && extrude) {
        man = extrude(polys, height, 0, 0, { x: 1, y: 1 });
        polys.delete();
      } else {
        man = cs.extrude(height);
      }
      cs.delete();
      return keep(man);
    },
    box: (w, d, h) => keep(mf().Manifold.cube([w, d, h], true)),
    union: (parts) => keep(mf().Manifold.union(parts)),
    sub: (a, b) => keep(a.subtract(b)),
    add: (a, b) => keep(a.add(b)),
    intersect: (a, b) => keep(a.intersect(b)),
    move: (a, x, y, z) => keep(a.translate([x, y, z])),
    transform: (a, m) => keep(a.transform(m)),
    finish: (final) => {
      const g = toGeometry(final);
      for (const s of items) s.delete();
      items.length = 0;
      return g;
    },
  };
}
