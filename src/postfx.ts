/**
 * Cinematic post-processing stack — ported from the SnowSystemThreeJS project:
 *   Render -> Depth of Field -> Bloom -> tone map / sRGB (OutputPass) -> Film grade
 *
 * The grade pass runs last (display space) and adds the "shot on film" feel:
 * radial chromatic aberration, contrast/saturation grading, vignette and grain.
 */
import {
  Scene, PerspectiveCamera, WebGLRenderer, WebGLRenderTarget, HalfFloatType, Vector2,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const FilmGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.15 },
    uVignetteSize: { value: 0.4 },
    uGrain: { value: 0.0 },
    uChroma: { value: 0.0025 },
    uContrast: { value: 1.0 },
    uSaturation: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uVignetteSize, uGrain, uChroma, uContrast, uSaturation;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 dir = vUv - 0.5;

      // Radial chromatic aberration — stronger toward the frame edges.
      float ca = uChroma * dot(dir, dir) * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - dir * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + dir * ca).b;

      // Contrast + saturation grade.
      col = (col - 0.5) * uContrast + 0.5;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, uSaturation);

      // Vignette.
      float vig = smoothstep(uVignetteSize, 0.85, length(dir));
      col *= 1.0 - vig * uVignette;

      // Animated film grain.
      float g = rand(vUv + fract(uTime)) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

type UniformMap = Record<string, { value: number }>;

export class PostFX {
  readonly composer: EffectComposer;
  readonly bokeh: BokehPass;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    // multisampled HDR target keeps edges clean through the stack
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bokeh = new BokehPass(scene, camera, { focus: 9.7, aperture: 0.0012, maxblur: 0.005 });
    this.bokeh.enabled = false; // off by default — opt in when framing
    this.composer.addPass(this.bokeh);

    this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.04, 0.7, 0.62);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass()); // tone mapping + sRGB

    this.grade = new ShaderPass(FilmGradeShader);
    this.composer.addPass(this.grade); // last -> display space
  }

  /** BokehPass focus/aperture/maxblur uniforms (for the GUI + focus plane). */
  get bokehUniforms(): UniformMap {
    return this.bokeh.uniforms as unknown as UniformMap;
  }

  /** FilmGrade uniforms (for the GUI). */
  get gradeUniforms(): UniformMap {
    return this.grade.uniforms as unknown as UniformMap;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  render(dt: number): void {
    this.gradeUniforms["uTime"].value += dt;
    this.composer.render();
  }
}
