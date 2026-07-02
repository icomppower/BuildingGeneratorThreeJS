/**
 * Cinematic studio lighting rig, ported from the rain-system project:
 *   - RoomEnvironment image-based lighting (soft, neutral reflections)
 *   - warm hard key light (casts the shadows) + cool fill + warm rim spotlight
 *   - dim ambient so nothing reads pure black
 *   - dark background with light exponential fog, ACES tone mapping at exposure 0.5
 * Light positions are fitted to the live building bounds so any size stays framed.
 */
import {
  Scene, WebGLRenderer, DirectionalLight, SpotLight, AmbientLight, Vector3, Color,
  PMREMGenerator, PCFSoftShadowMap, FogExp2,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type GUI from "lil-gui";

export interface Bounds {
  center: Vector3;
  radius: number;
}

const BG = 0x05060a;
const KEY_DIR = new Vector3(8, 12, 6).normalize();
const FILL_DIR = new Vector3(-9, 5, -4).normalize();
const RIM_DIR = new Vector3(-6, 8, -10).normalize();

export class Environment {
  readonly key = new DirectionalLight(0xfff1dd, 3.0);   // warm, hard, shadows
  readonly fill = new DirectionalLight(0x4a6cff, 0.6);  // cool fill
  readonly rim = new SpotLight(0xffd9a0, 120, 50, Math.PI * 0.25, 0.4, 1.2); // warm back light
  readonly ambient = new AmbientLight(0x223044, 0.4);

  settings = {
    exposure: 0.5,
    envIntensity: 0.35,
    fog: true,
    fogDensity: 0.006,
  };

  private scene: Scene;
  private renderer: WebGLRenderer;

  constructor(scene: Scene, renderer: WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;

    scene.background = new Color(BG);
    scene.fog = new FogExp2(BG, this.settings.fogDensity);

    // image-based lighting: soft neutral studio reflections
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = this.settings.envIntensity;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.toneMappingExposure = this.settings.exposure;

    const s = this.key.shadow;
    this.key.castShadow = true;
    s.mapSize.set(2048, 2048);
    s.bias = -0.0002;
    s.normalBias = 0.02;

    scene.add(this.key, this.key.target);
    scene.add(this.fill);
    scene.add(this.rim, this.rim.target);
    scene.add(this.ambient);
  }

  /** fit the light positions + shadow frustum around the current building bounds */
  frame(b: Bounds): void {
    const dist = Math.max(b.radius * 2.4, 20);

    this.key.position.copy(b.center).addScaledVector(KEY_DIR, dist);
    this.key.target.position.copy(b.center);
    this.key.target.updateMatrixWorld();

    this.fill.position.copy(b.center).addScaledVector(FILL_DIR, dist);

    this.rim.position.copy(b.center).addScaledVector(RIM_DIR, dist);
    this.rim.target.position.copy(b.center);
    this.rim.target.updateMatrixWorld();
    this.rim.distance = dist * 2.4;
    this.rim.angle = Math.atan2(b.radius * 1.5, dist);

    const cam = this.key.shadow.camera;
    const r = b.radius * 1.3;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 0.5;
    cam.far = dist + b.radius * 3;
    cam.updateProjectionMatrix();
  }

  /** re-apply settings (used by the GUI + dev hook) */
  refresh(): void {
    this.renderer.toneMappingExposure = this.settings.exposure;
    this.scene.environmentIntensity = this.settings.envIntensity;
    const fog = this.scene.fog as FogExp2 | null;
    if (fog) fog.density = this.settings.fog ? this.settings.fogDensity : 0;
  }

  /** no per-frame work — the environment map is baked once */
  tick(): void {}

  addGui(gui: GUI): void {
    const f = gui.addFolder("lighting");
    f.add(this.settings, "exposure", 0, 3, 0.01).name("exposure")
      .onChange((v: number) => (this.renderer.toneMappingExposure = v));
    f.add(this.key, "intensity", 0, 8, 0.01).name("key");
    f.add(this.fill, "intensity", 0, 4, 0.01).name("fill");
    f.add(this.rim, "intensity", 0, 400, 1).name("rim");
    f.add(this.settings, "envIntensity", 0, 2, 0.01).name("env / IBL")
      .onChange((v: number) => (this.scene.environmentIntensity = v));
    f.add(this.settings, "fog").name("fog").onChange(() => this.refresh());
    f.add(this.settings, "fogDensity", 0, 0.03, 0.0005).name("fog density")
      .onChange(() => this.refresh());
    f.close();
  }
}
