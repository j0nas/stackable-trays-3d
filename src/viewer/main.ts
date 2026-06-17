// Parametric web app: sliders -> live Three.js preview of the 3D-printed A4 tray, plus STL export.
// The 3D model and the exported mesh come from the same buildTray() so they can never drift.

import {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { defaults, dims, type Params, PRINTERS } from "../params.ts";
import { buildTray } from "../tray.ts";

const params: Params = { ...defaults };

const app = document.getElementById("app")!;

// --- renderer ---------------------------------------------------------------
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
app.appendChild(renderer.domElement);

// --- scene / camera ---------------------------------------------------------
const scene = new Scene();
scene.background = new Color(0xeef1f4);

const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new PerspectiveCamera(45, 1, 1, 8000);
camera.up.set(0, 0, 1); // Z up, matching the model / slicer convention

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// --- lighting ---------------------------------------------------------------
scene.add(new HemisphereLight(0xffffff, 0x9098a0, 0.55));
const sun = new DirectionalLight(0xffffff, 2.2);
sun.position.set(180, -260, 420);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  near: 1,
  far: 1600,
  left: -320,
  right: 320,
  top: 320,
  bottom: -320,
});
scene.add(sun);

// shadow-catcher ground (transparent, shows only the contact shadow)
const ground = new Mesh(new PlaneGeometry(4000, 4000), new ShadowMaterial({ opacity: 0.16 }));
ground.receiveShadow = true;
scene.add(ground);

// --- tray mesh --------------------------------------------------------------
const material = new MeshStandardMaterial({ color: 0x3f8fbf, roughness: 0.45, metalness: 0 });
const mesh = new Mesh(buildTray(params), material);
mesh.castShadow = true;
mesh.receiveShadow = true;
scene.add(mesh);

// Stacked preview: two more trays sharing the live geometry, nested on top (positioned in
// updateStack). Shows how the ridge/groove register and how the open fronts stay accessible.
const stackMeshes: Mesh[] = Array.from({ length: 2 }, () => {
  const m = new Mesh(mesh.geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  m.visible = false;
  scene.add(m);
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
scene.add(paper);

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

function rebuild(): void {
  const old = mesh.geometry;
  mesh.geometry = buildTray(params);
  old.dispose();
  updatePaper();
  updateStack();
  updateReadout();
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

function frameCamera(): void {
  const box = new Box3().setFromObject(mesh);
  for (const m of stackMeshes) if (m.visible) box.expandByObject(m);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 1.9;
  camera.near = maxDim / 100;
  camera.far = maxDim * 60;
  camera.position.set(center.x + dist * 0.75, center.y - dist, center.z + dist * 0.7);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function resize(): void {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

// --- controls panel ---------------------------------------------------------
type NumKey = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params];
type Ctrl = { key: NumKey; label: string; min: number; max: number; step: number; group: string };
const CONTROLS: Ctrl[] = [
  { key: "capture", label: "Tray depth (footprint)", min: 150, max: 297, step: 1, group: "size" },
  { key: "clearance", label: "Clearance / side", min: 0, max: 20, step: 0.5, group: "size" },
  { key: "depth", label: "Wall height", min: 15, max: 90, step: 1, group: "size" },
  { key: "frontLip", label: "Front lip (0 = open)", min: 0, max: 40, step: 1, group: "size" },
  { key: "wall", label: "Wall thickness", min: 1.6, max: 4, step: 0.2, group: "build" },
  { key: "floor", label: "Floor thickness", min: 1.6, max: 4, step: 0.2, group: "build" },
  { key: "cornerRadius", label: "Corner radius", min: 0, max: 20, step: 0.5, group: "build" },
  { key: "ridgeHeight", label: "Ridge height", min: 0.6, max: 2.2, step: 0.1, group: "stack" },
  { key: "ridgeWidth", label: "Ridge width", min: 0.8, max: 3, step: 0.1, group: "stack" },
  { key: "patternMargin", label: "Pattern margin", min: 2, max: 20, step: 0.5, group: "pattern" },
  { key: "patternScale", label: "Pattern size", min: 5, max: 16, step: 0.5, group: "pattern" },
];
const tidy = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const syncers: Array<() => void> = [];

for (const c of CONTROLS) {
  const row = document.createElement("div");
  row.className = "row";

  const label = document.createElement("label");
  label.textContent = c.label;

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(c.min);
  range.max = String(c.max);
  range.step = String(c.step);
  range.value = String(params[c.key]);

  const num = document.createElement("input");
  num.type = "text";
  num.value = tidy(params[c.key]);

  const apply = (raw: number): void => {
    const v = Math.min(Math.max(raw, c.min), c.max);
    params[c.key] = v;
    range.value = String(v);
    num.value = tidy(v);
    scheduleRebuild();
  };
  range.addEventListener("input", () => apply(Number(range.value)));
  num.addEventListener("change", () => {
    const v = Number(num.value);
    if (!Number.isNaN(v)) apply(v);
  });
  syncers.push(() => {
    range.value = String(params[c.key]);
    num.value = tidy(params[c.key]);
  });

  row.append(label, range, num);
  document.querySelector(`[data-group="${c.group}"]`)?.append(row);
}

const paperToggle = document.getElementById("showPaper") as HTMLInputElement;
paperToggle.addEventListener("change", updatePaper);

const wallStyleSel = document.getElementById("wallStyle") as HTMLSelectElement;
wallStyleSel.value = params.wallStyle;
wallStyleSel.addEventListener("change", () => {
  params.wallStyle = wallStyleSel.value as Params["wallStyle"];
  rebuild();
});

const materialSel = document.getElementById("material") as HTMLSelectElement;
materialSel.addEventListener("change", updateReadout);

const floorStyleSel = document.getElementById("floorStyle") as HTMLSelectElement;
floorStyleSel.value = params.floorStyle;
floorStyleSel.addEventListener("change", () => {
  params.floorStyle = floorStyleSel.value as Params["floorStyle"];
  rebuild();
});

const ridgeToggle = document.getElementById("stackRidge") as HTMLInputElement;
ridgeToggle.addEventListener("change", () => {
  params.stackRidge = ridgeToggle.checked;
  rebuild();
});

// View-only: render two extra trays nested on top. Vertical pitch = tray height H, so the upper
// tray's floor lands on the lower walls' top edge (ridge drops into groove).
const showStackToggle = document.getElementById("showStack") as HTMLInputElement;
function updateStack(): void {
  const H = dims(params).H;
  stackMeshes.forEach((m, i) => {
    m.geometry = mesh.geometry;
    m.position.z = (i + 1) * H;
    m.visible = showStackToggle.checked;
  });
}
showStackToggle.addEventListener("change", () => {
  updateStack();
  frameCamera();
});

// --- readout ----------------------------------------------------------------
const dimsEl = document.getElementById("dims")!;
const fitsEl = document.getElementById("fits")!;
const DENSITY: Record<string, number> = { PLA: 1.24, PETG: 1.27, ABS: 1.04, TPU: 1.21 };

// Solid volume of the current mesh (cm^3) via the signed-tetrahedron sum.
function meshVolumeCm3(): number {
  const g = mesh.geometry;
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

function updateReadout(): void {
  const d = dims(params);
  const long = Math.max(d.outerW, d.outerL);
  const short = Math.min(d.outerW, d.outerL);
  const pct = Math.round((params.capture / params.a4Length) * 100);
  const mat = materialSel.value;
  const grams = Math.round(meshVolumeCm3() * (DENSITY[mat] ?? 1.24));
  dimsEl.textContent = `${d.outerW.toFixed(0)} × ${d.outerL.toFixed(0)} mm · holds ${pct}% of A4 · ≈ ${grams} g ${mat} (solid)`;

  // Compatibility badges: which Bambu Lab beds this footprint fits (part may rotate 90°).
  fitsEl.replaceChildren();
  for (const pr of PRINTERS) {
    const ok = long <= Math.max(pr.w, pr.d) && short <= Math.min(pr.w, pr.d);
    const badge = document.createElement("span");
    badge.className = ok ? "fit ok" : "fit no";
    badge.textContent = pr.name;
    badge.title = `${pr.name}: ${pr.w} × ${pr.d} mm — ${ok ? "fits" : "too big"}`;
    fitsEl.append(badge);
  }
}

// --- STL export -------------------------------------------------------------
const exporter = new STLExporter();
document.getElementById("download")!.addEventListener("click", () => {
  const data = exporter.parse(new Mesh(mesh.geometry), { binary: true });
  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `a4-tray-${Math.round(params.capture)}deep.stl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

document.getElementById("reset")!.addEventListener("click", () => {
  Object.assign(params, defaults);
  for (const sync of syncers) sync();
  wallStyleSel.value = params.wallStyle;
  floorStyleSel.value = params.floorStyle;
  ridgeToggle.checked = params.stackRidge;
  rebuild();
  frameCamera();
});

// --- go ---------------------------------------------------------------------
resize();
updateReadout();
updatePaper();
frameCamera();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
