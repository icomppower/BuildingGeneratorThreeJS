/**
 * Cinematic post-processing stack: multisampled HDR render, UnrealBloom for the
 * emissive shop signs, and an optional depth-of-field (bokeh) pass focused on the
 * orbit target. OutputPass applies tone mapping + sRGB at the end.
 */
import {
  Scene, PerspectiveCamera, WebGLRenderer, WebGLRenderTarget, HalfFloatType, Vector2,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type GUI from "lil-gui";

export class PostFX {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private bokeh: BokehPass;
  private getFocusDistance: () => number = () => 20;

  settings = {
    bloom: true,
    bloomStrength: 0.5,
    bloomRadius: 0.5,
    bloomThreshold: 0.85,
    dof: false,
    aperture: 1.4,   // arbitrary units → uniform * 1e-4
    maxBlur: 0.9,    // → uniform * 0.01
  };

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      new Vector2(size.x, size.y),
      this.settings.bloomStrength,
      this.settings.bloomRadius,
      this.settings.bloomThreshold,
    );
    this.composer.addPass(this.bloom);

    this.bokeh = new BokehPass(scene, camera, { focus: 20, aperture: 0.0002, maxblur: 0.01 });
    this.bokeh.enabled = this.settings.dof;
    this.composer.addPass(this.bokeh);

    this.composer.addPass(new OutputPass());
  }

  /** DoF focuses on whatever this returns (the orbit target distance) */
  setFocusSource(getDistance: () => number): void {
    this.getFocusDistance = getDistance;
  }

  render(): void {
    if (this.bokeh.enabled) {
      const u = this.bokeh.uniforms as Record<string, { value: number }>;
      u["focus"].value = this.getFocusDistance();
      u["aperture"].value = this.settings.aperture * 1e-4;
      u["maxblur"].value = this.settings.maxBlur * 0.01;
    }
    this.composer.render();
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  addGui(gui: GUI): void {
    const f = gui.addFolder("post fx");
    f.add(this.settings, "bloom").name("bloom").onChange((v: boolean) => (this.bloom.enabled = v));
    f.add(this.settings, "bloomStrength", 0, 2, 0.01).name("bloom strength")
      .onChange((v: number) => (this.bloom.strength = v));
    f.add(this.settings, "bloomRadius", 0, 1, 0.01).name("bloom radius")
      .onChange((v: number) => (this.bloom.radius = v));
    f.add(this.settings, "bloomThreshold", 0, 1, 0.01).name("bloom threshold")
      .onChange((v: number) => (this.bloom.threshold = v));
    f.add(this.settings, "dof").name("depth of field")
      .onChange((v: boolean) => (this.bokeh.enabled = v));
    f.add(this.settings, "aperture", 0, 5, 0.01).name("dof strength");
    f.add(this.settings, "maxBlur", 0, 2, 0.01).name("dof max blur");
    f.close();
  }
}
