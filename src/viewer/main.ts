// App entry: holds the params, builds the tray mesh (+ stack preview + item placeholder), and wires
// the UI to the geometry. The preview and the exported STL come from the same buildTray() so they can
// never drift. Scene/render plumbing lives in scene.ts; the readout and sliders in their own modules.

import {
  BoxGeometry,
  type BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { initCSG } from "../csg.ts";
import { buildLabelClip } from "../label.ts";
import { defaults, dims, ITEM_PRESETS, type Params } from "../params.ts";
import { buildTray, labelRailPlacement } from "../tray.ts";
import { buildControls } from "./controls.ts";
import { createReadout } from "./readout.ts";
import { createViewer } from "./scene.ts";
import { clearParams, loadParams, saveParams } from "./storage.ts";

const params: Params = loadParams(defaults); // restore the last session's settings, if any

await initCSG(wasmUrl); // load the Manifold (manifold-3d) WASM kernel before any geometry is built

const app = document.getElementById("app")!;
const viewer = createViewer(app);

// manifold-3d returns a properly welded mesh (shared vertices), so a plain computeVertexNormals()
// averages normals across the sharp 90° CAD edges and the model looks soft/melted. Split the normals
// at any edge sharper than ~30° instead: flat faces stay crisp, while the rounded corners and arcs
// (tessellated in ~7.5° steps) still shade smoothly. Positions/triangles are untouched, so the
// exported STL is identical. Disposes the source geometry once creased.
const CREASE_ANGLE = Math.PI / 6; // 30°
function creased(src: BufferGeometry): BufferGeometry {
  const g = toCreasedNormals(src, CREASE_ANGLE);
  src.dispose();
  g.computeBoundingBox();
  return g;
}

// --- meshes -----------------------------------------------------------------
// Matte, near-non-metallic so it reads like a printed part, not glossy plastic.
const material = new MeshStandardMaterial({ color: 0x3f8fbf, roughness: 0.72, metalness: 0 });
const mesh = new Mesh(creased(buildTray(params)), material);
mesh.castShadow = true;
mesh.receiveShadow = true;
viewer.scene.add(mesh);

// Stacked preview: two more trays sharing the live geometry, nested on top (positioned in
// updateStack). Shows how the ridge/groove register and how the open fronts stay accessible.
const stackMeshes: Mesh[] = Array.from({ length: 2 }, () => {
  const m = new Mesh(mesh.geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  m.visible = false;
  viewer.scene.add(m);
  return m;
});

// Removable label clip preview: a separate printed part that snaps onto a front-corner rail. Its
// geometry is fixed (only the tray's footprint moves the rail), so build it once and just reposition.
// One mesh per front corner — the Label dropdown shows left / right / both. A contrasting colour
// makes clear it's a distinct part you print and clip on.
const clipMaterial = new MeshStandardMaterial({ color: 0xe0883a, roughness: 0.72, metalness: 0 });
const clipGeometry = creased(buildLabelClip());
const clips: Record<"left" | "right", Mesh> = { left: new Mesh(), right: new Mesh() };
for (const m of Object.values(clips)) {
  m.geometry = clipGeometry;
  m.material = clipMaterial;
  m.castShadow = true;
  m.visible = false;
  viewer.scene.add(m);
}

// Translucent item placeholder: shows how much of the item the tray holds vs. what overhangs the open
// front (or, when enclosed, the clearance gap all around).
const itemMat = new MeshStandardMaterial({
  color: 0xf7f4e8,
  roughness: 0.95,
  metalness: 0,
  transparent: true,
  opacity: 0.5,
  side: DoubleSide,
});
const item = new Mesh(new BoxGeometry(1, 1, 1), itemMat);
item.renderOrder = 1;
viewer.scene.add(item);

// --- UI elements ------------------------------------------------------------
const itemToggle = document.getElementById("showItem") as HTMLInputElement;
const showStackToggle = document.getElementById("showStack") as HTMLInputElement;
const itemPresetSel = document.getElementById("itemPreset") as HTMLSelectElement;
const wallStyleSel = document.getElementById("wallStyle") as HTMLSelectElement;
const floorStyleSel = document.getElementById("floorStyle") as HTMLSelectElement;
const materialSel = document.getElementById("material") as HTMLSelectElement;
const ridgeToggle = document.getElementById("stackRidge") as HTMLInputElement;
const labelSel = document.getElementById("labelRail") as HTMLSelectElement;
const downloadClipBtn = document.getElementById("downloadClip") as HTMLButtonElement;

// Populate the item-preset dropdown from the single source of truth (params.ts). "Custom…" (value "")
// stays selected whenever the dimensions don't match a preset.
for (const preset of ITEM_PRESETS) {
  const opt = document.createElement("option");
  opt.value = preset.name;
  opt.textContent = preset.name;
  itemPresetSel.append(opt);
}
function syncPreset(): void {
  const match = ITEM_PRESETS.find(
    (p) => p.width === params.itemWidth && p.length === params.itemLength,
  );
  itemPresetSel.value = match ? match.name : "";
}

wallStyleSel.value = params.wallStyle;
floorStyleSel.value = params.floorStyle;
ridgeToggle.checked = params.stackRidge; // reflect a restored value (HTML defaults to checked)
labelSel.value = params.labelRail;

const readout = createReadout({
  dimsEl: document.getElementById("dims")!,
  fitsEl: document.getElementById("fits")!,
  legendEl: document.getElementById("fitsLegend")!,
  materialSel,
  getGeometry: () => mesh.geometry,
});

function updateItem(): void {
  const d = dims(params);
  const t = 1.5; // visual item thickness
  item.geometry.dispose();
  item.geometry = new BoxGeometry(params.itemWidth, params.itemLength, t);
  // rear edge sits one clearance in front of the back wall; the item runs forward — overhanging the
  // open front when frontOverhang > 0, or sitting a clearance inside it when enclosed.
  const yBack = d.innerL / 2 - params.clearance;
  item.position.set(0, yBack - params.itemLength / 2, params.floor + t / 2 + 0.4);
  item.visible = itemToggle.checked;
}

// View-only: render two extra trays nested on top. Vertical pitch = tray height H, so the upper
// tray's floor lands on the lower walls' top edge (ridge drops into groove).
function updateStack(): void {
  const H = dims(params).H;
  stackMeshes.forEach((m, i) => {
    m.geometry = mesh.geometry;
    m.position.z = (i + 1) * H;
    m.visible = showStackToggle.checked;
  });
}

// Place a clip preview on each enabled front corner (origin = the socket seat on the rail). The
// download button shows whenever a rail exists, regardless of which corner(s).
function updateClip(): void {
  const place = labelRailPlacement(params);
  for (const side of ["left", "right"] as const) {
    const on = place !== null && place.sides.includes(side);
    clips[side].visible = on;
    if (on && place) clips[side].position.set(place.x[side], place.faceY, place.seatZ);
  }
  downloadClipBtn.style.display = place ? "block" : "none";
}

const visibleObjects = (): Object3D[] => [
  mesh,
  ...stackMeshes.filter((m) => m.visible),
  ...Object.values(clips).filter((m) => m.visible),
];

function rebuild(persist = true): void {
  if (persist) saveParams(params); // persist on every change; reset passes false so it can forget
  const old = mesh.geometry;
  mesh.geometry = creased(buildTray(params));
  old.dispose();
  updateItem();
  updateStack();
  updateClip();
  syncPreset(); // reflect item dims changed via the sliders (drops to "Custom…" when off-preset)
  readout(params);
  viewer.invalidate();
}

// Coalesce rapid slider input to one rebuild per frame, so a fast drag can't queue up a backlog of
// (heavier) pattern rebuilds — the model just tracks the latest value.
let rafPending = 0;
function scheduleRebuild(): void {
  if (rafPending) return;
  rafPending = requestAnimationFrame(() => {
    rafPending = 0;
    rebuild();
  });
}

const sliders = buildControls(params, scheduleRebuild);

// --- event wiring -----------------------------------------------------------
itemToggle.addEventListener("change", () => {
  updateItem();
  viewer.invalidate();
});
// Picking a preset sets only the two item dimensions; clamp the overhang to the new length, then push
// everything back into the sliders and rebuild.
itemPresetSel.addEventListener("change", () => {
  const preset = ITEM_PRESETS.find((p) => p.name === itemPresetSel.value);
  if (!preset) return; // "Custom…" — leave the current dimensions alone
  params.itemWidth = preset.width;
  params.itemLength = preset.length;
  // A preset means "a tray that fully holds this item", so enclose it: overhang 0 leaves the item
  // sitting inside the footprint with clearance on every side. The open-front overhang stays a
  // deliberate manual tweak the user opts into afterwards via the Front overhang slider.
  params.frontOverhang = 0;
  sliders.sync();
  rebuild();
});
showStackToggle.addEventListener("change", () => {
  updateStack();
  viewer.frameCamera(visibleObjects());
});
materialSel.addEventListener("change", () => readout(params)); // estimate only — no rebuild/redraw
wallStyleSel.addEventListener("change", () => {
  params.wallStyle = wallStyleSel.value as Params["wallStyle"];
  rebuild();
});
floorStyleSel.addEventListener("change", () => {
  params.floorStyle = floorStyleSel.value as Params["floorStyle"];
  rebuild();
});
ridgeToggle.addEventListener("change", () => {
  params.stackRidge = ridgeToggle.checked;
  rebuild();
});
labelSel.addEventListener("change", () => {
  params.labelRail = labelSel.value as Params["labelRail"];
  rebuild();
  viewer.frameCamera(visibleObjects()); // bring the clip(s) (or the freed-up tray) into view
});

document.getElementById("download")!.addEventListener("click", () => {
  const exporter = new STLExporter();
  const data = exporter.parse(new Mesh(mesh.geometry), { binary: true });
  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox; // true footprint incl. the label rail, matching the readout
  const w = bb ? bb.max.x - bb.min.x : dims(params).outerW;
  const l = bb ? bb.max.y - bb.min.y : dims(params).outerL;
  const a = document.createElement("a");
  a.href = url;
  a.download = `tray-${Math.round(w)}x${Math.round(l)}mm.stl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

// The label clip is a separate part. It's modelled base-down (every face is a vertical extrusion or a
// flat ledge), so it exports ready to print flat with no supports.
downloadClipBtn.addEventListener("click", () => {
  const exporter = new STLExporter();
  const data = exporter.parse(new Mesh(buildLabelClip()), { binary: true });
  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tray-label-clip.stl";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

// Reset to defaults and forget the persisted settings, so a later reload tracks the current defaults
// rather than a saved snapshot. rebuild(false) rebuilds without re-persisting.
document.getElementById("reset")!.addEventListener("click", () => {
  Object.assign(params, defaults);
  clearParams();
  sliders.sync();
  wallStyleSel.value = params.wallStyle;
  floorStyleSel.value = params.floorStyle;
  ridgeToggle.checked = params.stackRidge;
  labelSel.value = params.labelRail;
  rebuild(false);
  viewer.frameCamera(visibleObjects());
});

// --- go ---------------------------------------------------------------------
updateItem();
updateClip(); // place + show the clip preview if labelRail was restored on (rebuild isn't run yet)
syncPreset(); // reflect restored item dims in the preset dropdown
readout(params);
viewer.frameCamera(visibleObjects());
viewer.start();
