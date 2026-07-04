"""Export the asset kit used by the 'build system' geometry nodes to a single GLB.

Each collection child becomes a top-level node named COL[<collection>][<idx>] with its
transform reset (mirroring CollectionInfo's Separate Children + Reset Children).
Collection-instance empties and nested collections are realized recursively — this
matters: e.g. ROOMS children instance a 'floor_preset' collection and the store_roof
object is an empty instancing 'groud_roof_preset'.

blender --background source/procedural_building.blend --python tools/export_kit.py -- kit.glb kit_manifest.json
"""
import bpy
import json
import sys
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
out_glb = argv[0]
out_manifest = argv[1]

COLLECTIONS = [
    "AC WIRE.001", "ac.001", "cloth lines WITH CLOTHES.001", "cloth lines.001",
    "corner", "CURTAINS.001", "eletricarea", "groud side wall", "groud_front",
    "ground_back", "ground_corner", "guardrail back", "guardrail front",
    "guardrailside", "lights.001", "lightsground", "old store_sign", "prop_front",
    "prop_groud", "prop_store", "roof", "roof.002", "roof_prop", "roofcorner",
    "ROOMS.001", "shutter", "side_wall", "steel window top preset.001",
    "store_sign", "store_sign_hanging", "storefront", "storeinside", "wall.001",
    "watertank", "window guard.001", "window wood top preset.001", "wire",
]
OBJECTS = ["steel frame.001", "steel window.001", "store_roof", "wood frame.001", "wood window.001"]

export_scene = bpy.data.scenes.new("KIT_EXPORT")
bpy.context.window.scene = export_scene

manifest = {"collections": {}, "objects": {}}
part_count = 0
mesh_count = 0


def expand(obj, matrix, root):
    """Realize obj at `matrix` (relative to part root): copy meshes, recurse into
    collection-instance empties."""
    global mesh_count
    if obj.type == "MESH":
        dup = obj.copy()
        export_scene.collection.objects.link(dup)
        dup.parent = root
        dup.matrix_parent_inverse = mathutils.Matrix.Identity(4)
        dup.matrix_basis = matrix
        mesh_count += 1
    elif obj.type == "EMPTY" and obj.instance_collection:
        icol = obj.instance_collection
        off = mathutils.Matrix.Translation(-mathutils.Vector(icol.instance_offset))
        for o in icol.all_objects:
            expand(o, matrix @ off @ o.matrix_world, root)


def make_part(node_name):
    global part_count
    root = bpy.data.objects.new(node_name, None)
    export_scene.collection.objects.link(root)
    part_count += 1
    return root


def export_collection_child(col_name, idx, kind, child):
    node_name = f"COL[{col_name}][{idx}]"
    root = make_part(node_name)
    if kind == "OBJECT":
        # child placed at identity (Reset Children); bring parented descendants along
        inv = child.matrix_world.inverted()
        expand(child, mathutils.Matrix.Identity(4), root)
        for desc in child.children_recursive:
            expand(desc, inv @ desc.matrix_world, root)
        return {"index": idx, "kind": "OBJECT", "name": child.name}
    else:
        # sub-collection child: unit keeps its internal world-space layout
        for o in child.all_objects:
            expand(o, o.matrix_world.copy(), root)
        return {"index": idx, "kind": "COLLECTION", "name": child.name}


for col_name in COLLECTIONS:
    col = bpy.data.collections.get(col_name)
    if not col:
        print("MISSING COLLECTION:", col_name)
        manifest["collections"][col_name] = {"missing": True}
        continue
    # CollectionInfo "Separate Children" emits children in NAME-sorted order (verified
    # against the evaluated node graph), NOT raw col.objects order — so sort by name or
    # the generator's index picks land on the wrong variant (e.g. storeinside had
    # 'ground room2'/'ground room1' swapped, pairing the wrong room under each storefront).
    # No collection mixes loose objects with sub-collections, so collections-then-objects
    # never actually interleaves; sort each list independently by name.
    children = [("COLLECTION", c) for c in sorted(col.children, key=lambda c: c.name)] + \
               [("OBJECT", o) for o in sorted(col.objects, key=lambda o: o.name)
                if o.parent is None or o.parent.name not in col.objects]
    entries = [export_collection_child(col_name, i, k, c) for i, (k, c) in enumerate(children)]
    manifest["collections"][col_name] = {"children": entries}

for obj_name in OBJECTS:
    obj = bpy.data.objects.get(obj_name)
    if not obj:
        print("MISSING OBJECT:", obj_name)
        manifest["objects"][obj_name] = {"missing": True}
        continue
    root = make_part(f"OBJ[{obj_name}]")
    inv = obj.matrix_world.inverted()
    expand(obj, mathutils.Matrix.Identity(4), root)
    for desc in obj.children_recursive:
        expand(desc, inv @ desc.matrix_world, root)
    manifest["objects"][obj_name] = {"exported": True}

bpy.context.view_layer.update()

bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format="GLB",
    use_active_scene=True,
    export_apply=True,
    export_yup=False,  # keep Blender Z-up; three.js side rotates the root
    export_image_format="AUTO",
    export_materials="EXPORT",
    export_animations=False,
    export_skins=False,
)

with open(out_manifest, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=1)

print("EXPORT_OK", part_count, "parts,", mesh_count, "meshes ->", out_glb)
