// Generic Three.js viewer: renderer, scene, camera, lighting, a shadow-catcher ground, orbit
// controls and the render loop. Knows nothing about the tray — main.ts adds the model and wires the
// UI. Rendering is on-demand: the loop only draws when something changed (camera, geometry, resize),
// so a static model costs ~zero GPU while idle.

import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  type Object3D,
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

export type Viewer = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  invalidate: () => void; // request one render (call after any non-camera scene change)
  frameCamera: (objects: Object3D[]) => void; // fit the camera around the given objects
  start: () => void; // begin the render loop
};

export function createViewer(app: HTMLElement): Viewer {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  app.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0xeef1f4);

  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new PerspectiveCamera(45, 1, 1, 8000);
  camera.up.set(0, 0, 1); // Z up, matching the model / slicer convention

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

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

  let needsRender = true;
  const invalidate = (): void => {
    needsRender = true;
  };
  // OrbitControls fires 'change' on drag and on every damping step, so interaction re-renders; when
  // motion settles the events stop and the loop goes quiet.
  controls.addEventListener("change", invalidate);

  function frameCamera(objects: Object3D[]): void {
    const box = new Box3();
    for (const o of objects) box.expandByObject(o);
    if (box.isEmpty()) return;
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
    invalidate();
  }

  function resize(): void {
    const w = app.clientWidth;
    const h = app.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }
  window.addEventListener("resize", resize);
  resize();

  function start(): void {
    renderer.setAnimationLoop(() => {
      controls.update(); // advances damping; sets needsRender via the 'change' listener when moving
      if (needsRender) {
        renderer.render(scene, camera);
        needsRender = false;
      }
    });
  }

  return { scene, camera, renderer, controls, invalidate, frameCamera, start };
}
