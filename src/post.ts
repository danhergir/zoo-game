import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Tilt-shift blur: sharp in a horizontal band around `focus`, blurring
 * smoothly toward the top and bottom of the screen for a miniature look.
 * Run twice (horizontal + vertical) via `direction`.
 */
const TiltShiftShader = {
  name: 'TiltShiftShader',
  uniforms: {
    tDiffuse: { value: null },
    direction: { value: new THREE.Vector2(1, 0) },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    focus: { value: 0.5 },
    band: { value: 0.2 },
    amount: { value: 0.6 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 direction;
    uniform vec2 texel;
    uniform float focus;
    uniform float band;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      float d = max(0.0, abs(vUv.y - focus) - band) / (1.0 - band);
      vec2 step = direction * texel * amount * d * 4.0;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.1633;
      sum += (texture2D(tDiffuse, vUv + step * 1.0) + texture2D(tDiffuse, vUv - step * 1.0)) * 0.1531;
      sum += (texture2D(tDiffuse, vUv + step * 2.0) + texture2D(tDiffuse, vUv - step * 2.0)) * 0.12245;
      sum += (texture2D(tDiffuse, vUv + step * 3.0) + texture2D(tDiffuse, vUv - step * 3.0)) * 0.0918;
      sum += (texture2D(tDiffuse, vUv + step * 4.0) + texture2D(tDiffuse, vUv - step * 4.0)) * 0.051;
      gl_FragColor = sum;
    }`,
};

/** Ambient occlusion + tilt-shift + tone mapping, with MSAA on the scene render. */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly tiltH = new ShaderPass(TiltShiftShader);
  private readonly tiltV = new ShaderPass(TiltShiftShader);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 16 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.gtao.blendIntensity = 0.85;
    this.composer.addPass(this.gtao);

    this.tiltV.uniforms.direction.value.set(0, 1);
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    for (const p of [this.tiltH, this.tiltV]) {
      p.uniforms.texel.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
      p.uniforms.amount.value = 0.6 * pixelRatio;
    }
  }

  render(): void {
    this.composer.render();
  }
}
