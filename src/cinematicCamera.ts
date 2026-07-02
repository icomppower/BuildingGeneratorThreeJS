/**
 * Cinematic camera controller layered on top of OrbitControls: framed presets with
 * smooth eased fly-to transitions, an auto-orbit turntable, and animated FOV. Presets
 * are computed from the live building bounds so framing adapts to any size.
 */
import { PerspectiveCamera, Vector3, Spherical, MathUtils } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Bounds } from "./environment";

export type PresetName = "hero" | "front" | "street" | "aerial" | "corner";

interface Shot {
  pos: Vector3;
  target: Vector3;
  fov: number;
}

// azimuth / elevation (deg), fov, framing margin, and a vertical target bias (0..1 of height)
const PRESETS: Record<PresetName, { azim: number; elev: number; fov: number; margin: number; targetY: number }> = {
  hero:   { azim: 35,  elev: 16, fov: 40, margin: 1.15, targetY: 0.5 },
  front:  { azim: 0,   elev: 6,  fov: 36, margin: 1.2,  targetY: 0.5 },
  street: { azim: 24,  elev: 2,  fov: 60, margin: 0.75, targetY: 0.22 },
  aerial: { azim: 14,  elev: 62, fov: 46, margin: 1.05, targetY: 0.55 },
  corner: { azim: 58,  elev: 22, fov: 30, margin: 1.1,  targetY: 0.5 },
};

const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export class CinematicCamera {
  auto = false;
  autoSpeed = 7; // deg / sec
  onUserInteract?: () => void;

  private tween: { from: Shot; to: Shot; t: number; dur: number } | null = null;
  private sph = new Spherical();
  private v = new Vector3();

  constructor(
    private cam: PerspectiveCamera,
    private controls: OrbitControls,
    private getBounds: () => Bounds,
  ) {
    controls.addEventListener("start", () => {
      this.auto = false;
      this.tween = null;
      this.controls.enabled = true;
      this.onUserInteract?.();
    });
  }

  private shot(name: PresetName): Shot {
    const p = PRESETS[name];
    const b = this.getBounds();
    const dist = (b.radius / Math.sin(MathUtils.degToRad(p.fov / 2))) * p.margin;
    const target = new Vector3(
      b.center.x,
      (b.center.y * 2) * p.targetY, // center.y is half-height, so *2 = full height
      b.center.z,
    );
    const dir = new Vector3().setFromSphericalCoords(
      dist,
      MathUtils.degToRad(90 - p.elev),
      MathUtils.degToRad(p.azim),
    );
    return { pos: target.clone().add(dir), target, fov: p.fov };
  }

  private current(): Shot {
    return { pos: this.cam.position.clone(), target: this.controls.target.clone(), fov: this.cam.fov };
  }

  /** eased fly-to a preset */
  goTo(name: PresetName): void {
    this.auto = false;
    this.tween = { from: this.current(), to: this.shot(name), t: 0, dur: 1.3 };
    this.controls.enabled = false;
  }

  /** jump instantly (used for initial framing) */
  snap(name: PresetName): void {
    const s = this.shot(name);
    this.cam.position.copy(s.pos);
    this.controls.target.copy(s.target);
    this.cam.fov = s.fov;
    this.cam.updateProjectionMatrix();
    this.controls.update();
  }

  update(dt: number): void {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = smoother(tw.t);
      this.cam.position.lerpVectors(tw.from.pos, tw.to.pos, k);
      this.controls.target.lerpVectors(tw.from.target, tw.to.target, k);
      this.cam.fov = MathUtils.lerp(tw.from.fov, tw.to.fov, k);
      this.cam.updateProjectionMatrix();
      if (tw.t >= 1) {
        this.tween = null;
        this.controls.enabled = true;
      }
    } else if (this.auto) {
      this.v.copy(this.cam.position).sub(this.controls.target);
      this.sph.setFromVector3(this.v);
      this.sph.theta += MathUtils.degToRad(this.autoSpeed) * dt;
      this.v.setFromSpherical(this.sph);
      this.cam.position.copy(this.controls.target).add(this.v);
    }
    this.controls.update();
  }
}
