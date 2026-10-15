import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Draw-call reduction. Meshes that share a material (and shadow flags) are
 * baked into one geometry, so the GPU draws them in a single call.
 */

interface Bucket {
  material: THREE.Material;
  cast: boolean;
  receive: boolean;
  noRaycast: boolean;
  layers: number;
  geos: THREE.BufferGeometry[];
}

const KEEP_ATTRIBUTES = ['position', 'normal', 'uv', 'color'];

function bake(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(matrix);
  for (const name of Object.keys(g.attributes)) {
    if (!KEEP_ATTRIBUTES.includes(name)) g.deleteAttribute(name);
  }
  return g;
}

function add(buckets: Map<string, Bucket>, mesh: THREE.Mesh, matrix: THREE.Matrix4): void {
  const material = mesh.material as THREE.Material;
  // Meshes whose raycast was switched off (outline hulls) stay unpickable after merging.
  const noRaycast = mesh.raycast !== THREE.Mesh.prototype.raycast;
  const key = `${material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${noRaycast}|${mesh.layers.mask}`;
  let b = buckets.get(key);
  if (!b) {
    b = { material, cast: mesh.castShadow, receive: mesh.receiveShadow, noRaycast, layers: mesh.layers.mask, geos: [] };
    buckets.set(key, b);
  }
  b.geos.push(bake(mesh.geometry, matrix));
}

function build(buckets: Map<string, Bucket>): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const b of buckets.values()) {
    // Attribute sets must match; drop any that not every geometry has.
    const shared = KEEP_ATTRIBUTES.filter((n) => b.geos.every((g) => g.getAttribute(n)));
    for (const g of b.geos) {
      for (const n of Object.keys(g.attributes)) if (!shared.includes(n)) g.deleteAttribute(n);
    }
    const merged = mergeGeometries(b.geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    if (b.noRaycast) mesh.raycast = () => {};
    mesh.layers.mask = b.layers;
    out.push(mesh);
  }
  return out;
}

function mergeable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  return m.isMesh === true && !(o as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && m.material.visible;
}

/**
 * Bakes every mesh under `root` (static scenery) into as few meshes as
 * possible. `root` must not have a parent yet. Returns a new group;
 * non-mergeable objects are moved into it unchanged.
 */
export function mergeStatic(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, Bucket>();
  const keep: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o === root) return;
    if (mergeable(o)) add(buckets, o, o.matrixWorld);
    else if ((o as THREE.Mesh).isMesh || (o as THREE.Light).isLight) keep.push(o);
  });
  const out = new THREE.Group();
  out.add(...build(buckets));
  for (const k of keep) {
    const clone = k.clone(false);
    k.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    out.add(clone);
  }
  return out;
}

/**
 * Merges the meshes directly under `group` (and their mesh children, e.g.
 * outline hulls) while keeping sub-groups such as joints untouched.
 * Use on animated rigs, once per pivot.
 */
export function mergeChildren(group: THREE.Object3D): void {
  const meshes = group.children.filter(mergeable);
  if (meshes.length < 2) return;
  const buckets = new Map<string, Bucket>();
  for (const m of meshes) {
    m.updateMatrix();
    add(buckets, m, m.matrix);
    for (const c of m.children) {
      if (!mergeable(c)) continue;
      c.updateMatrix();
      add(buckets, c, new THREE.Matrix4().multiplyMatrices(m.matrix, c.matrix));
    }
  }
  group.remove(...meshes);
  group.add(...build(buckets));
}

/** mergeChildren on `root` and every group below it. */
export function mergeRig(root: THREE.Object3D): void {
  const groups: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) groups.push(o);
  });
  for (const g of groups) mergeChildren(g);
}
