"""Export authored Sun + packed HDR + exact World-node panorama without saving the source.

Run with Blender --background --disable-autoexec /path/brutalist_A_final.blend
--python scripts/export-brutalist-lighting.py
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

out = Path(__file__).resolve().parents[1] / 'web/public/environments/brutalist/daylight'
out.mkdir(parents=True, exist_ok=True)
source = bpy.context.scene
world = source.world
image = next(n.image for n in world.node_tree.nodes if n.type == 'TEX_ENVIRONMENT' and n.image)
if not image.packed_file:
    raise RuntimeError('Expected the source panorama to be packed in the Blender file.')
(out / image.name).write_bytes(image.packed_file.data)
metadata = {
    'source': Path(bpy.data.filepath).name,
    'coordinateTransform': 'Blender XYZ to Three X,Z,-Y; metres',
    'lights': [],
    'view': {
        'transform': source.view_settings.view_transform,
        'exposure': source.view_settings.exposure,
        'gamma': source.view_settings.gamma,
    },
}
for obj in source.objects:
    if obj.type != 'LIGHT' or obj.hide_render:
        continue
    direction = obj.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    p = obj.matrix_world.translation
    metadata['lights'].append({
        'name': obj.name, 'type': obj.data.type, 'energy': obj.data.energy,
        'colorLinear': list(obj.data.color),
        'position': [p.x, p.z, -p.y],
        'direction': [direction.x, direction.z, -direction.y],
        'angleRadians': getattr(obj.data, 'angle', None),
    })
background = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
mix = next(n for n in world.node_tree.nodes if n.type == 'MIX')
metadata['world'] = {
    'file': 'authored-world_1k.hdr', 'sourceFile': image.name,
    'size': [1024, 512], 'strength': background.inputs['Strength'].default_value,
    'blendMode': mix.blend_type, 'blendFactor': mix.inputs[0].default_value,
    'blendColor': list(mix.inputs[7].default_value),
    'bakedNodeGraph': True, 'bakedStrength': True,
    'orientation': 'equirectangular centre Three+X, image right Three+Z, image up Three+Y',
}
# A new empty in-memory scene isolates the World shader. No geometry or Sun is
# baked into this panorama; runtime geometry is responsible for actual shadows.
scene = bpy.data.scenes.new('Signal World Export')
scene.world = world
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 1
scene.cycles.use_denoising = False
scene.cycles.use_adaptive_sampling = False
scene.render.resolution_x = 1024
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'HDR'
scene.render.image_settings.color_mode = 'RGB'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
cam_data = bpy.data.cameras.new('World Panorama')
cam_data.type = 'PANO'
cam_data.panorama_type = 'EQUIRECTANGULAR'
cam = bpy.data.objects.new('World Panorama', cam_data)
scene.collection.objects.link(cam)
# Matches the EnvironmentTexture equirectangular basis after Y-up conversion.
cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
scene.camera = cam
scene.render.filepath = str(out / metadata['world']['file'])
bpy.ops.render.render(write_still=True, scene=scene.name)
(out / 'lighting.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('Exported original gallery lighting to', out)
