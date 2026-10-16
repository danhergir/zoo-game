import * as THREE from 'three';

const outlineCache = new Map<number, THREE.ShaderMaterial>();

/**
 * Inverted-hull outline: draws back faces pushed out along the normal.
 * Works best on smooth geometry (spheres, capsules, cylinders).
 */
export function outlineMaterial(thickness: number): THREE.ShaderMaterial {
  let m = outlineCache.get(thickness);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color('#2a2018') } },
    // Works for skinned meshes too: the hull follows the bones.
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      uniform float thickness;
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec3 p = transformed + normalize(objectNormal) * thickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      void main() {
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
  });
  outlineCache.set(thickness, m);
  return m;
}

/**
 * Zebra stripes computed in the shader from the mesh's local position,
 * so they wrap correctly around any shape without UVs.
 * `axis` is the local axis the bands run across; `wobble` bends them.
 */
export function stripeMaterial(axis: 'y' | 'z', frequency: number): THREE.MeshStandardMaterial {
  const other = axis === 'z' ? 'y' : 'x';
  const m = new THREE.MeshStandardMaterial({ color: '#f5f2ea', roughness: 0.85 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStripePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStripePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStripePos;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float sc = vStripePos.${axis} * ${frequency.toFixed(3)} + sin(vStripePos.${other} * 5.0) * 0.22;
        float f = fract(sc);
        float band = smoothstep(0.48, 0.53, f) * (1.0 - smoothstep(0.93, 0.98, f));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045), band);`,
      );
  };
  m.customProgramCacheKey = () => `stripes-${axis}-${frequency}`;
  return m;
}

/**
 * Reticulated giraffe coat: brown patches separated by pale lines, from a
 * 3D cell pattern in the mesh's local space (so it wraps any shape).
 */
export function spotMaterial(frequency: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#f2dcab', roughness: 0.85 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSpotPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpotPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vSpotPos;
        vec3 spotHash(vec3 p) {
          p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
          return fract(sin(p) * 43758.5453123);
        }
        // Distance between the nearest and second-nearest cell centers: small along cell borders.
        float spotEdge(vec3 x) {
          vec3 n = floor(x);
          vec3 f = fract(x);
          float f1 = 8.0;
          float f2 = 8.0;
          for (int k = -1; k <= 1; k++)
            for (int j = -1; j <= 1; j++)
              for (int i = -1; i <= 1; i++) {
                vec3 g = vec3(float(i), float(j), float(k));
                vec3 r = g + spotHash(n + g) - f;
                float d = dot(r, r);
                if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
              }
          return sqrt(f2) - sqrt(f1);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float patchMask = smoothstep(0.07, 0.13, spotEdge(vSpotPos * ${frequency.toFixed(3)}));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.25, 0.085, 0.02), patchMask);`,
      );
  };
  m.customProgramCacheKey = () => `spots-${frequency}`;
  return m;
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

let dirt: THREE.CanvasTexture | null = null;
/** Neutral blotchy texture; tinted by the material color. Tiles every 16 units. */
export function dirtTexture(): THREE.CanvasTexture {
  dirt ??= canvasTexture(256, (ctx) => {
    ctx.fillStyle = '#e6e6e6';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = 2 + Math.random() * 14;
      const v = 200 + Math.floor(Math.random() * 55);
      ctx.fillStyle = `rgba(${v},${v},${v - 10},0.35)`;
      for (const [dx, dy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < 1500; i++) {
      const v = 170 + Math.floor(Math.random() * 80);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  });
  return dirt;
}

let cobble: THREE.CanvasTexture | null = null;
/** Paving stones; tiles every 6 units. */
export function cobbleTexture(): THREE.CanvasTexture {
  cobble ??= canvasTexture(256, (ctx) => {
    ctx.fillStyle = '#a89a80';
    ctx.fillRect(0, 0, 256, 256);
    const rows = 8;
    const h = 256 / rows;
    for (let row = 0; row < rows; row++) {
      let x = row % 2 ? -h * 0.5 : 0;
      while (x < 256) {
        const w = h * (0.8 + Math.random() * 0.6);
        const v = 205 + Math.floor(Math.random() * 30);
        ctx.fillStyle = `rgb(${v},${v - 12},${v - 34})`;
        ctx.beginPath();
        ctx.roundRect(x + 2, row * h + 2, w - 4, h - 4, 6);
        ctx.fill();
        x += w;
      }
    }
  });
  return cobble;
}

let planks: THREE.CanvasTexture | null = null;
/** Wooden boards running along the texture's U axis. */
export function plankTexture(): THREE.CanvasTexture {
  planks ??= canvasTexture(256, (ctx) => {
    const rows = 8;
    const h = 256 / rows;
    for (let row = 0; row < rows; row++) {
      const v = 150 + Math.floor(Math.random() * 30);
      ctx.fillStyle = `rgb(${v},${Math.floor(v * 0.68)},${Math.floor(v * 0.42)})`;
      ctx.fillRect(0, row * h, 256, h);
      ctx.fillStyle = 'rgba(60,35,15,0.55)';
      ctx.fillRect(0, row * h, 256, 2);
      ctx.fillRect(Math.random() * 256, row * h, 2, h);
    }
  });
  return planks;
}

/** A clone of `tex` sharing its image, with its own repeat. */
export function repeated(tex: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}
