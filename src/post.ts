import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Objects on this layer are drawn normally but skipped by the ambient-occlusion depth pass. */
export const NO_AO_LAYER = 1;

/**
 * Tilt-shift blur in a single pass: sharp in a horizontal band around `focus`,
 * blurring toward the top and bottom of the screen for a miniature look.
 * Pixels inside the band skip the blur entirely.
 */
const TiltShiftShader = {
  name: 'TiltShiftShader',
  uniforms: {
    tDiffuse: { value: null },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    focus: { value: 0.5 },
    band: { value: 0.2 },
    amount: { value: 2.4 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    uniform float focus;
    uniform float band;
    uniform float amount;
    varying vec2 vUv;
    // 12-tap Poisson disc.
    const vec2 taps[12] = vec2[](
      vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
      vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
      vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
    );
    void main() {
      float d = max(0.0, abs(vUv.y - focus) - band) / (1.0 - band);
      vec4 center = texture2D(tDiffuse, vUv);
      if (d <= 0.0) {
        gl_FragColor = center;
        return;
      }
      vec2 radius = texel * amount * d * 4.0;
      vec4 sum = center;
      for (int i = 0; i < 12; i++) sum += texture2D(tDiffuse, vUv + taps[i] * radius);
      gl_FragColor = sum / 13.0;
    }`,
};

/** Ambient occlusion + tilt-shift + tone mapping, with MSAA on the scene render. */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly tilt = new ShaderPass(TiltShiftShader);
  /** Copy of the main camera that doesn't see NO_AO_LAYER, used for the AO depth pass. */
  private readonly aoCamera: THREE.PerspectiveCamera;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    this.aoCamera = camera.clone();
    this.gtao = new GTAOPass(scene, this.aoCamera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    this.gtao.blendIntensity = 0.85;
    this.composer.addPass(this.gtao);

    this.composer.addPass(this.tilt);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    // Ambient occlusion is soft and blurred anyway; half resolution is ~4x cheaper and looks the same.
    this.gtao.setSize(Math.round((width * pixelRatio) / 2), Math.round((height * pixelRatio) / 2));
    this.tilt.uniforms.texel.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
    this.tilt.uniforms.amount.value = 1.6 * pixelRatio;
  }

  render(): void {
    this.aoCamera.copy(this.camera);
    this.aoCamera.layers.set(0);
    this.composer.render();
  }
}
