// App entry: holds the params, builds the tray mesh (+ stack preview + A4 sheet), and wires the UI
// to the geometry. The preview and the exported STL come from the same buildTray() so they can never
// drift. Scene/render plumbing lives in scene.ts; the readout and sliders in their own modules.

import { BoxGeometry, DoubleSide, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { defaults, dims, type Params } from "../params.ts";
import { buildTray } from "../tray.ts";
import { buildControls } from "./controls.ts";
import { createReadout } from "./readout.ts";
import { createViewer } from "./scene.ts";
import { clearParams, loadParams, saveParams } from "./storage.ts";

const params: Params = loadParams(defaults); // restore the last session's settings, if any

const app = document.getElementById("app")!;
const viewer = createViewer(app);

// --- meshes -----------------------------------------------------------------
const material = new MeshStandardMaterial({ color: 0x3f8fbf, roughness: 0.45, metalness: 0 });
const mesh = new Mesh(buildTray(params), material);
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

// Translucent A4 sheet: shows how much of the page the tray holds vs. what overhangs the open front.
const paperMat = new MeshStandardMaterial({
  color: 0xf7f4e8,
  roughness: 0.95,
  metalness: 0,
  transparent: true,
  opacity: 0.5,
  side: DoubleSide,
});
const paper = new Mesh(new BoxGeometry(1, 1, 1), paperMat);
paper.renderOrder = 1;
viewer.scene.add(paper);

// --- UI elements ------------------------------------------------------------
const paperToggle = document.getElementById("showPaper") as HTMLInputElement;
const showStackToggle = document.getElementById("showStack") as HTMLInputElement;
const wallStyleSel = document.getElementById("wallStyle") as HTMLSelectElement;
const floorStyleSel = document.getElementById("floorStyle") as HTMLSelectElement;
const materialSel = document.getElementById("material") as HTMLSelectElement;
const ridgeToggle = document.getElementById("stackRidge") as HTMLInputElement;
wallStyleSel.value = params.wallStyle;
floorStyleSel.value = params.floorStyle;
ridgeToggle.checked = params.stackRidge; // reflect a restored value (HTML defaults to checked)

const readout = createReadout({
  dimsEl: document.getElementById("dims")!,
  fitsEl: document.getElementById("fits")!,
  legendEl: document.getElementById("fitsLegend")!,
  materialSel,
  getGeometry: () => mesh.geometry,
});

function updatePaper(): void {
  const d = dims(params);
  const t = 1.5; // visual sheet thickness
  paper.geometry.dispose();
  paper.geometry = new BoxGeometry(params.a4Width, params.a4Length, t);
  // rear edge sits one clearance in front of the back wall; the sheet runs forward and overhangs
  const yBack = d.innerL / 2 - params.clearance;
  paper.position.set(0, yBack - params.a4Length / 2, params.floor + t / 2 + 0.4);
  paper.visible = paperToggle.checked;
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

const visibleObjects = (): Object3D[] => [mesh, ...stackMeshes.filter((m) => m.visible)];

function rebuild(persist = true): void {
  if (persist) saveParams(params); // persist on every change; reset passes false so it can forget
  const old = mesh.geometry;
  mesh.geometry = buildTray(params);
  old.dispose();
  updatePaper();
  updateStack();
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
paperToggle.addEventListener("change", () => {
  updatePaper();
  viewer.invalidate();
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

document.getElementById("download")!.addEventListener("click", () => {
  const exporter = new STLExporter();
  const data = exporter.parse(new Mesh(mesh.geometry), { binary: true });
  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `a4-tray-${Math.round(params.capture)}deep.stl`;
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
  rebuild(false);
  viewer.frameCamera(visibleObjects());
});

// --- go ---------------------------------------------------------------------
updatePaper();
readout(params);
viewer.frameCamera(visibleObjects());
viewer.start();
