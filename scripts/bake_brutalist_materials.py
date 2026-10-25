"""Bake the author's procedural gallery materials without modifying their .blend.

Run with Blender 5.x:
  Blender --background --disable-autoexec --python scripts/bake_brutalist_materials.py
Optional arguments after --: --preview (256px floor proof), --samples N.
The source coordinates and evaluated geometry are preserved. BakeUV is separate
from the original UVMap so the author's procedural coordinates remain intact.
"""
import argparse
import bmesh
import bpy
import hashlib
import json
import math
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'brutalist_A_final.blend'
OUT = ROOT / 'web/public/environments/brutalist'
MAT = OUT / 'materials'
MAT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--preview', action='store_true')
parser.add_argument('--samples', type=int, default=16)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
started = time.time()

def log(*parts):
    print('BAKE', *parts, flush=True)

source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE), use_scripts=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = False
scene.render.bake.margin = 8
scene.render.bake.use_selected_to_active = False
scene.render.bake.normal_space = 'TANGENT'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.color_depth = '8'
scene.render.image_settings.compression = 90

names = {
    'walls.001', 'floor.001', 'floor_tiles', 'Plane', 'ceiling_lights_rail',
    'walls.panels.001', 'walls.002', 'walls.outside.panels', 'walls.outside',
    'windows.001', 'Plane.002', 'wall_switch.001', 'Plane.001',
    *[f'ceiling_light.{i:03}' for i in range(10, 21)],
    *[f'ceiling_light_big.{i:03}' for i in range(1, 7)],
    *[f'wall_plug.{i:03}' for i in range(1, 5)],
    *[f'sculpture.{i:03}' for i in range(9)],
    *[f'stand.{i:03}' for i in range(1, 10)],
}
if args.preview:
    names = {'floor_tiles'}

# Evaluate once, retaining the actual bevels/subdivision/arrays in the FBX.
depsgraph = bpy.context.evaluated_depsgraph_get()
originals = list(scene.objects)
objects = []
for source in originals:
    if source.name not in names or source.type != 'MESH':
        continue
    name = source.name
    mesh = bpy.data.meshes.new_from_object(source.evaluated_get(depsgraph), preserve_all_data_layers=True, depsgraph=depsgraph)
    source.name = '__source__' + name
    if not len(mesh.polygons):
        bpy.data.meshes.remove(mesh)
        continue
    obj = bpy.data.objects.new(name, mesh)
    obj.matrix_world = source.matrix_world.copy()
    scene.collection.objects.link(obj)
    obj['sourceObject'] = name
    objects.append(obj)
for obj in originals:
    bpy.data.objects.remove(obj, do_unlink=True)

# Keep window glass and frames independently shadowable in Three.js.
window = next((o for o in objects if o.name == 'windows.001'), None)
if window:
    for slot, material in enumerate(window.data.materials):
        mesh = window.data.copy()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != slot], context='FACES')
        bm.to_mesh(mesh)
        bm.free()
        if not len(mesh.polygons):
            bpy.data.meshes.remove(mesh)
            continue
        mesh.materials.clear()
        mesh.materials.append(material)
        for poly in mesh.polygons:
            poly.material_index = 0
        name = 'windows_glass' if 'glass' in material.name else 'windows_frame'
        obj = bpy.data.objects.new(name, mesh)
        obj.matrix_world = window.matrix_world.copy()
        obj['sourceObject'] = 'windows.001'
        scene.collection.objects.link(obj)
        objects.append(obj)
    objects.remove(window)
    bpy.data.objects.remove(window, do_unlink=True)

# glTF supports transmission/IOR, but cannot represent a Cycles light-path switch.
# Use the author's camera-ray glass color, roughness and IOR, retain the clear pane.
glass = bpy.data.materials.get('glass.external')
if glass:
    glass_nodes = glass.node_tree.nodes
    authored = next(n for n in glass_nodes if n.type == 'BSDF_GLASS')
    glass_color = tuple(authored.inputs['Color'].default_value)
    glass_roughness = authored.inputs['Roughness'].default_value
    glass_ior = authored.inputs['IOR'].default_value
    pbr_glass = bpy.data.materials.new('glass.external.web')
    pbr_glass.use_nodes = True
    shader = pbr_glass.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = glass_color
    shader.inputs['Roughness'].default_value = glass_roughness
    shader.inputs['IOR'].default_value = glass_ior
    shader.inputs['Transmission Weight'].default_value = 1
    for obj in objects:
        for slot in obj.material_slots:
            if slot.material == glass:
                slot.material = pbr_glass

def principled(material):
    if not material or not material.use_nodes:
        return None
    return next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)

def needs_bake(material):
    shader = principled(material)
    return bool(shader and any(shader.inputs[name].is_linked for name in ('Base Color', 'Roughness', 'Metallic', 'Normal')))

# The original web scene hides these four objects outside the room. Keep their
# geometry and constant materials, but don't waste atlas space on hidden objects.
outside = {'sculpture.000', 'sculpture.007', 'stand.001', 'stand.005'}
groups = {'architecture': [], 'floor': [], 'props': []}
for obj in objects:
    if obj.name in outside or not any(needs_bake(m) for m in obj.data.materials):
        continue
    group = 'floor' if obj.name in {'floor_tiles', 'floor.001'} else 'props' if obj.name.startswith(('sculpture.', 'stand.')) or obj.name == 'Plane' else 'architecture'
    groups[group].append(obj)

def select_only(items):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in items:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = items[0]

def bake_uv(items, size):
    for obj in items:
        uv = obj.data.uv_layers.new(name='BakeUV')
        obj.data.uv_layers.active = uv
    select_only(items)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    # Multi-object unwrap packs all selected objects into one common atlas.
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=0.008)
    bpy.ops.object.mode_set(mode='OBJECT')
    # All source UV reads must still resolve to the original UV, not BakeUV.
    for obj in items:
        for uv in obj.data.uv_layers:
            uv.active_render = uv.name != 'BakeUV' and uv.name == obj.data.uv_layers[0].name

atlas_metadata = []
for group, items in groups.items():
    if not items:
        continue
    size = 256 if args.preview else 2048 if group == 'architecture' else 1024
    log(group, 'UV', len(items), 'objects', size)
    bake_uv(items, size)
    materials = {}
    for obj in items:
        for slot in obj.material_slots:
            original = slot.material
            if not original:
                continue
            if original not in materials:
                copied = original.copy()
                copied.name = original.name + '.bake.' + group
                materials[original] = copied
            slot.material = materials[original]
    images = {}
    # Each selected object writes into its own nonoverlapping atlas islands.
    for channel, bake_type in [('base', 'EMIT'), ('orm', 'EMIT'), ('normal', 'NORMAL')]:
        image = bpy.data.images.new(group + '_' + channel, width=size, height=size, alpha=False)
        image.colorspace_settings.name = 'sRGB' if channel == 'base' else 'Non-Color'
        images[channel] = image
        restored = []
        for original, mat in materials.items():
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            shader = principled(mat)
            target = nodes.new('ShaderNodeTexImage')
            target.image = image
            target.select = True
            nodes.active = target
            output = next((n for n in nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
            if not output:
                output = nodes.new('ShaderNodeOutputMaterial')
            old_surface = output.inputs['Surface'].links[0].from_socket if output.inputs['Surface'].is_linked else None
            restored.append((mat, output, old_surface, target))
            if channel in {'base', 'orm'}:
                emit = nodes.new('ShaderNodeEmission')
                emit.name = '__bake_emission'
                if channel == 'base':
                    socket = shader.inputs['Base Color'] if shader else None
                    if socket and socket.is_linked:
                        links.new(socket.links[0].from_socket, emit.inputs['Color'])
                    elif socket:
                        emit.inputs['Color'].default_value = socket.default_value
                    else:
                        emit.inputs['Color'].default_value = (0, 0, 0, 1)
                else:
                    combine = nodes.new('ShaderNodeCombineColor')
                    combine.name = '__bake_orm'
                    combine.mode = 'RGB'
                    combine.inputs['Red'].default_value = 1
                    for component, name, fallback in [('Green', 'Roughness', 0.5), ('Blue', 'Metallic', 0)]:
                        socket = shader.inputs[name] if shader else None
                        if socket and socket.is_linked:
                            links.new(socket.links[0].from_socket, combine.inputs[component])
                        else:
                            combine.inputs[component].default_value = socket.default_value if socket else fallback
                    links.new(combine.outputs[0], emit.inputs['Color'])
                links.new(emit.outputs[0], output.inputs['Surface'])
            elif shader:
                # Bake the authored bump chain; the outside shader's ray switch
                # is irrelevant for a tangent normal atlas.
                links.new(shader.outputs[0], output.inputs['Surface'])
        select_only(items)
        scene.render.bake.use_clear = True
        log(group, channel, 'start', round(time.time() - started, 1))
        bpy.ops.object.bake(type=bake_type, uv_layer='BakeUV', use_clear=True, margin=8)
        if channel == 'orm' and not args.preview:
            image.scale(size // 2, size // 2)
        image.filepath_raw = str(MAT / (('preview_' if args.preview else '') + group + '_' + channel + '.png'))
        image.file_format = 'PNG'
        image.save()
        log(group, channel, 'saved', image.filepath_raw, round(time.time() - started, 1))
        for mat, output, old_surface, target in restored:
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            if old_surface:
                links.new(old_surface, output.inputs['Surface'])
            else:
                for link in list(output.inputs['Surface'].links):
                    links.remove(link)
            nodes.remove(target)
            for name in ('__bake_emission', '__bake_orm'):
                node = nodes.get(name)
                if node:
                    nodes.remove(node)
    # All atlas users share the same authored PBR texture set. Keep per-material
    # names and scalar IOR so runtime role/material inspection remains useful.
    for original, old_mat in materials.items():
        mat = bpy.data.materials.new(original.name + '.atlas.' + group)
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        shader = nodes.get('Principled BSDF')
        authored = principled(original)
        if authored:
            shader.inputs['IOR'].default_value = authored.inputs['IOR'].default_value
        for channel in ('base', 'orm', 'normal'):
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = images[channel]
            if channel == 'base':
                links.new(tex.outputs['Color'], shader.inputs['Base Color'])
            elif channel == 'orm':
                separate = nodes.new('ShaderNodeSeparateColor')
                separate.mode = 'RGB'
                links.new(tex.outputs['Color'], separate.inputs[0])
                links.new(separate.outputs['Green'], shader.inputs['Roughness'])
                links.new(separate.outputs['Blue'], shader.inputs['Metallic'])
            else:
                normal = nodes.new('ShaderNodeNormalMap')
                normal.uv_map = 'BakeUV'
                links.new(tex.outputs['Color'], normal.inputs['Color'])
                links.new(normal.outputs[0], shader.inputs['Normal'])
        for obj in items:
            for slot in obj.material_slots:
                if slot.material == old_mat:
                    slot.material = mat
    for obj in items:
        # Remove source UVs only after baking, to guarantee one compact UV set.
        for uv in list(obj.data.uv_layers):
            if uv.name != 'BakeUV':
                obj.data.uv_layers.remove(uv)
        obj.data.uv_layers.active = obj.data.uv_layers.get('BakeUV')
        obj.data.uv_layers.active.active_render = True
    atlas_metadata.append({'group': group, 'objects': [o.name for o in items], 'resolution': size, 'ormResolution': size if args.preview else size // 2})

# Hidden sculptures cannot carry procedural materials into glTF. Constant source
# Principled values are a harmless fallback for already-hidden offsite geometry.
for obj in objects:
    obj.hide_render = False
    obj.hide_set(False)
select_only(objects)
destination = OUT / ('room-preview.glb' if args.preview else 'room-textured.glb')
export_options = dict(filepath=str(destination), export_format='GLB', use_selection=True,
    export_yup=True, export_apply=False, export_animations=False, export_lights=False,
    export_cameras=False, export_extras=True, export_materials='EXPORT',
    export_image_format='AUTO', export_texcoords=True, export_normals=True,
    export_tangents=True, export_draco_mesh_compression_enable=False)
bpy.ops.export_scene.gltf(**export_options)
compressed = False
if not args.preview and destination.stat().st_size > 25_000_000:
    # EXT_meshopt_compression is decoded by Three's bundled MeshoptDecoder.
    # Re-export from the same evaluated geometry rather than simplifying it.
    log('Meshopt compression for Quest download budget')
    bpy.ops.export_scene.gltf(**export_options, export_meshopt_compression_enable=True,
        export_meshopt_extension='EXT_meshopt_compression')
    compressed = True
meshes = []
for obj in objects:
    obj.data.calc_loop_triangles()
    meshes.append({'name': obj.name, 'source': obj.get('sourceObject'), 'vertices': len(obj.data.vertices),
        'triangles': len(obj.data.loop_triangles), 'materials': [m.name if m else None for m in obj.data.materials]})
metadata = {'source': str(SOURCE), 'sourceSha256': source_hash, 'sourceUnchanged': hashlib.sha256(SOURCE.read_bytes()).hexdigest() == source_hash,
    'output': destination.name, 'bytes': destination.stat().st_size, 'coordinateSystem': 'Blender metres exported glTF Y-up: (x, z, -y)',
    'scale': 1, 'bakeSamples': args.samples, 'meshoptCompressed': compressed, 'atlas': atlas_metadata, 'meshes': meshes,
    'authoredLightingManifest': '../daylight/lighting.json',
    'glassAdaptation': {'source': 'glass.external', 'web': 'glass.external.web', 'colorLinear': glass_color, 'roughness': glass_roughness, 'ior': glass_ior, 'transmission': 1} if glass else None,
    'elapsedSeconds': time.time() - started}
(MAT / ('preview-manifest.json' if args.preview else 'manifest.json')).write_text(json.dumps(metadata, indent=2))
log('DONE', destination, destination.stat().st_size, 'bytes', round(time.time() - started, 1), 'seconds')
