/**
 * Loads the exported asset kit (public/assets/kit.glb + kit_manifest.json) and
 * renders placement lists as InstancedMeshes (one per unique mesh in each part).
 *
 * Materials are built from scratch from the source texture files — the GLB-embedded
 * materials come through as alpha-blended (depth-sorting breaks at grazing angles),
 * so they are replaced wholesale by name: building / floor / glass.
 */
import {
  Group, InstancedMesh, Matrix4, Mesh, Object3D, DoubleSide, Color,
  MeshStandardMaterial, MeshPhysicalMaterial, Material, Texture, TextureLoader,
  SRGBColorSpace, NoColorSpace, RepeatWrapping,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Placement } from "./generator";

function tex(loader: TextureLoader, url: string, srgb = false): Texture {
  const t = loader.load(url);
  t.flipY = false; // glTF UV convention
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function buildMaterials(): Record<string, Material> {
  const loader = new TextureLoader();
  const building = new MeshStandardMaterial({
    name: "building",
    map: tex(loader, "/textures/Material_Base_color.png", true),
    normalMap: tex(loader, "/textures/Material_Normal_OpenGL.png"),
    roughnessMap: tex(loader, "/textures/Material_Roughness.png"),
    roughness: 1,
    metalnessMap: tex(loader, "/textures/Material_Metallic.png"),
    metalness: 1,
    emissiveMap: tex(loader, "/textures/Material_Emissive.png", true),
    emissive: new Color(0xffffff),
    emissiveIntensity: 1.4,
    side: DoubleSide,
  });
  const floor = new MeshStandardMaterial({
    name: "floor",
    map: tex(loader, "/textures/floor_Base_color.png", true),
    normalMap: tex(loader, "/textures/floor_Normal_OpenGL.png"),
    roughnessMap: tex(loader, "/textures/floor_Roughness.png"),
    roughness: 1,
    metalnessMap: tex(loader, "/textures/floor_Metallic.png"),
    metalness: 1,
    alphaMap: tex(loader, "/textures/floor_alpha.png"),
    alphaTest: 0.5, // cutout — no blend-sorting artifacts
    side: DoubleSide,
  });
  const glass = new MeshPhysicalMaterial({
    name: "glass",
    color: 0x9fb8c4,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: DoubleSide,
  });
  return { building, floor, glass };
}

interface ManifestCollection {
  children?: { index: number; kind: string; name: string }[];
  missing?: boolean;
}
interface Manifest {
  collections: Record<string, ManifestCollection>;
  objects: Record<string, unknown>;
}

export class Kit {
  private parts = new Map<string, Object3D>();
  private manifest!: Manifest;
  private warned = new Set<string>();

  count(collection: string): number {
    const c = this.manifest.collections[collection];
    return c?.children?.length || 1;
  }

  async load(glbUrl: string, manifestUrl: string): Promise<void> {
    const [gltf, manifest] = await Promise.all([
      new GLTFLoader().loadAsync(glbUrl),
      fetch(manifestUrl).then(r => r.json() as Promise<Manifest>),
    ]);
    this.manifest = manifest;
    // GLTFLoader sanitizes Object3D names (strips [ ] . and spaces) — recover the
    // original glTF node names through the parser associations
    const json = gltf.parser.json as { nodes?: { name?: string }[] };
    const assoc = gltf.parser.associations as Map<Object3D, { nodes?: number }>;
    for (const child of [...gltf.scene.children]) {
      const a = assoc.get(child);
      const original = a?.nodes !== undefined ? json.nodes?.[a.nodes]?.name : undefined;
      this.parts.set(original ?? child.name, child);
      child.updateMatrixWorld(true);
    }
    // replace GLB-embedded materials with the from-scratch ones (matched by name;
    // Blender exports "building", "floor", "glass")
    const materials = buildMaterials();
    const fallback = materials.building;
    gltf.scene.traverse(o => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const current = mesh.material as Material;
      const name = (current?.name ?? "").toLowerCase();
      let next = fallback;
      for (const key of Object.keys(materials)) {
        if (name.includes(key)) { next = materials[key]; break; }
      }
      mesh.material = next;
    });
  }

  /** Build a Group of InstancedMeshes from placements (matrices in Blender Z-up space). */
  buildGroup(placements: Placement[]): Group {
    const group = new Group();
    const byPart = new Map<string, Matrix4[]>();
    for (const pl of placements) {
      let list = byPart.get(pl.key);
      if (!list) byPart.set(pl.key, (list = []));
      list.push(pl.matrix);
    }

    const tmp = new Matrix4();
    for (const [key, matrices] of byPart) {
      const part = this.parts.get(key);
      if (!part) {
        if (!this.warned.has(key)) {
          this.warned.add(key);
          console.warn(`kit: missing part ${key}`);
        }
        continue;
      }
      part.traverse(o => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        // meshLocal = mesh transform relative to the part root (GLTFLoader splits
        // multi-material primitives into separate meshes, so material is single)
        const rootInv = new Matrix4().copy(part.matrixWorld).invert();
        const meshLocal = rootInv.multiply(mesh.matrixWorld);
        const im = new InstancedMesh(mesh.geometry, mesh.material as Material, matrices.length);
        im.castShadow = true;
        im.receiveShadow = true;
        for (let i = 0; i < matrices.length; i++) {
          tmp.copy(matrices[i]).multiply(meshLocal);
          im.setMatrixAt(i, tmp);
        }
        im.instanceMatrix.needsUpdate = true;
        group.add(im);
      });
    }
    return group;
  }
}
