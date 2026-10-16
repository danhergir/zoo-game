import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Turns a rig built from pivot groups and meshes into GPU-skinned meshes:
 * every pivot becomes a bone, and every mesh is baked into one skinned mesh
 * per material, bound 100% to its pivot's bone. A character then costs a
 * few draw calls instead of dozens, while animation code keeps rotating the
 * same joints (now bones).
 *
 * Returns a lookup from each original pivot to its bone, so models can
 * swap their joint references over.
 */
export function skinRig(root: THREE.Object3D): (pivot: THREE.Object3D) => THREE.Object3D {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const bones = new Map<THREE.Object3D, THREE.Bone>();
  const order: THREE.Bone[] = [];
  const pivots: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && !(o as THREE.Mesh).isMesh) pivots.push(o);
  });

  // Bones mirror the pivot hierarchy (parents come first in traversal order).
  for (const p of pivots) {
    const bone = new THREE.Bone();
    bone.position.copy(p.position);
    bone.quaternion.copy(p.quaternion);
    bone.scale.copy(p.scale);
    const parent = p.parent === root ? root : bones.get(p.parent!);
    (parent ?? root).add(bone);
    bones.set(p, bone);
    order.push(bone);
  }

  // Bake every visible mesh under a pivot into root space, tagged with its bone.
  interface Bucket {
    material: THREE.Material;
    cast: boolean;
    layers: number;
    noRaycast: boolean;
    geos: THREE.BufferGeometry[];
  }
  const buckets = new Map<string, Bucket>();
  const skinned: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || !mesh.material.visible) return;
    // Which pivot drives this mesh? (Outline hulls hang off their mesh, so look further up.)
    let p: THREE.Object3D | null = mesh.parent;
    while (p && (p as THREE.Mesh).isMesh) p = p.parent;
    const bone = p ? bones.get(p) : undefined;
    if (!bone) return; // e.g. the hitbox, directly under the root
    const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(
      new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld),
    );
    for (const name of Object.keys(geo.attributes)) {
      if (!['position', 'normal', 'color'].includes(name)) geo.deleteAttribute(name);
    }
    const count = geo.attributes.position.count;
    const index = order.indexOf(bone);
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4).fill(0).map((_, i) => (i % 4 === 0 ? index : 0)), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const material = mesh.material;
    const noRaycast = mesh.raycast !== THREE.Mesh.prototype.raycast;
    const key = `${material.uuid}|${mesh.castShadow}|${mesh.layers.mask}|${noRaycast}`;
    let b = buckets.get(key);
    if (!b) {
      b = { material, cast: mesh.castShadow, layers: mesh.layers.mask, noRaycast, geos: [] };
      buckets.set(key, b);
    }
    b.geos.push(geo);
    skinned.push(mesh);
  });

  // Drop the old pivots (and the meshes under them); bones take their place.
  for (const p of pivots) if (p.parent === root) root.remove(p);

  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(order);
  for (const b of buckets.values()) {
    const shared = ['position', 'normal', 'color'].filter((n) => b.geos.every((g) => g.getAttribute(n)));
    for (const g of b.geos) for (const n of ['normal', 'color']) if (!shared.includes(n)) g.deleteAttribute(n);
    const geo = mergeGeometries(b.geos);
    if (!geo) continue;
    const mesh = new THREE.SkinnedMesh(geo, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    mesh.layers.mask = b.layers;
    mesh.frustumCulled = false;
    if (b.noRaycast) mesh.raycast = () => {};
    root.add(mesh);
    mesh.bind(skeleton);
  }

  return (pivot) => bones.get(pivot) ?? pivot;
}
