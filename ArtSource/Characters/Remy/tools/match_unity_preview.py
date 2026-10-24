"""Match the Unity silhouette material in Blender's lightweight preview."""
import math
from pathlib import Path
import bpy
from mathutils import Vector

character_dir = Path(bpy.data.filepath).resolve().parent
if character_dir.name != 'Remy':
    raise RuntimeError('Open the Remy character source before running this script.')
scene = bpy.context.scene
if bpy.context.screen and bpy.context.screen.is_animation_playing:
    bpy.ops.screen.animation_play()
rig = bpy.data.objects['SignalCharacter_Rig']
body = bpy.data.objects['Remy_ClothedSilhouette']
hip_name = next(b.name for b in rig.pose.bones if b.name.endswith(':Hips'))
material = body.data.materials[0]
material.name = 'Signal / Unity-matched Cobalt + Text'
material.use_nodes = True
tree = material.node_tree
tree.nodes.clear()
nodes, links = tree.nodes, tree.links

def node(kind, name, x, y):
    n = nodes.new(kind)
    n.name = name
    n.label = name
    n.location = (x, y)
    return n

def math_node(operation, name, first=None, second=None, x=0, y=0):
    n = node('ShaderNodeMath', name, x, y)
    n.operation = operation
    for index, value in enumerate([first, second]):
        if value is None:
            continue
        if isinstance(value, (int, float)):
            n.inputs[index].default_value = value
        else:
            links.new(value, n.inputs[index])
    return n.outputs[0]

# The Unity effect projects into camera space and centres on the animated hips.
# These native transform drivers follow the pose without a Python frame handler.
anchor = node('ShaderNodeCombineXYZ', 'Animated hips / world position', -1600, -300)
for index, axis in enumerate('XYZ'):
    driver = anchor.inputs[index].driver_add('default_value').driver
    variable = driver.variables.new()
    variable.name = 'position'
    variable.type = 'TRANSFORMS'
    target = variable.targets[0]
    target.id = rig
    target.bone_target = hip_name
    target.transform_type = 'LOC_' + axis
    target.transform_space = 'WORLD_SPACE'
    driver.expression = 'position'
anchor_view = node('ShaderNodeVectorTransform', 'Hips in camera space', -1370, -300)
anchor_view.vector_type = 'POINT'
anchor_view.convert_from = 'WORLD'
anchor_view.convert_to = 'CAMERA'
links.new(anchor.outputs[0], anchor_view.inputs['Vector'])
surface = node('ShaderNodeNewGeometry', 'Surface world position', -1600, 300)
surface_view = node('ShaderNodeVectorTransform', 'Surface in camera space', -1370, 300)
surface_view.vector_type = 'POINT'
surface_view.convert_from = 'WORLD'
surface_view.convert_to = 'CAMERA'
links.new(surface.outputs['Position'], surface_view.inputs['Vector'])

anchor_xyz = node('ShaderNodeSeparateXYZ', 'Anchor depth', -1130, -300)
surface_xyz = node('ShaderNodeSeparateXYZ', 'Surface depth', -1130, 300)
links.new(anchor_view.outputs[0], anchor_xyz.inputs[0])
links.new(surface_view.outputs[0], surface_xyz.inputs[0])
depth_ratio = math_node('DIVIDE', 'Perspective depth correction', anchor_xyz.outputs['Z'], surface_xyz.outputs['Z'], -900, 220)
projected = node('ShaderNodeVectorMath', 'Project onto hip plane', -690, 250)
projected.operation = 'SCALE'
links.new(surface_view.outputs[0], projected.inputs[0])
links.new(depth_ratio, projected.inputs[3])
relative = node('ShaderNodeVectorMath', 'Camera-facing offset from hips', -470, 250)
relative.operation = 'SUBTRACT'
links.new(projected.outputs[0], relative.inputs[0])
links.new(anchor_view.outputs[0], relative.inputs[1])
scale = node('ShaderNodeVectorMath', 'Unity TextSize: 1.25 m x 2 m', -250, 250)
scale.operation = 'MULTIPLY'
scale.inputs[1].default_value = (1 / 1.25, 1 / 2.0, 0)
links.new(relative.outputs[0], scale.inputs[0])
offset = node('ShaderNodeVectorMath', 'Centre UV', -30, 250)
offset.operation = 'ADD'
offset.inputs[1].default_value = (0.5, 0.5, 0)
links.new(scale.outputs[0], offset.inputs[0])
uv = node('ShaderNodeSeparateXYZ', 'Projected UV', 190, 250)
links.new(offset.outputs[0], uv.inputs[0])

time = node('ShaderNodeValue', 'Animation time / seconds', -250, -500)
time.outputs[0].default_value = 0
time.outputs[0].driver_add('default_value').driver.expression = '(frame - 1) / 30'
scroll = math_node('MULTIPLY', 'Unity ScrollSpeed: 0.012', time.outputs[0], 0.012, 0, -500)
v = math_node('ADD', 'Scroll text', uv.outputs['Y'], scroll, 410, 100)

# Same sparse horizontal jitter as SignalText.hlsl, without temporal smearing.
row = math_node('FLOOR', 'Text row', math_node('MULTIPLY', '35 rows', v, 35, 410, -120), x=620, y=-120)
tick = math_node('FLOOR', 'Glitch tick', math_node('MULTIPLY', '9 ticks per second', time.outputs[0], 9, 0, -700), x=210, y=-700)
noise_argument = math_node('ADD', 'Noise seed', math_node('MULTIPLY', 'Row seed', row, 12.9898, 830, -120), math_node('MULTIPLY', 'Time seed', tick, 78.233, 420, -700), 1050, -120)
noise = math_node('FRACT', 'Row noise', math_node('MULTIPLY', 'Hash', math_node('SINE', 'Hash sine', noise_argument, x=1250, y=-120), 43758.5453, 1450, -120), x=1650, y=-120)
gate = math_node('GREATER_THAN', 'Sparse glitch', noise, 0.87, 1850, -260)
jitter = math_node('MULTIPLY', 'Unity GlitchAmount: 0.015', math_node('SUBTRACT', 'Centred noise', noise, 0.5, 1850, -80), 0.015, 2050, -80)
jitter = math_node('MULTIPLY', 'Occasional horizontal jitter', jitter, gate, 2250, -80)
u = math_node('ADD', 'Text U', uv.outputs['X'], jitter, 2450, 200)
wrapped_v = math_node('FRACT', 'Repeat vertically', v, x=2450, y=-100)
coordinates = node('ShaderNodeCombineXYZ', 'Text coordinates', 2660, 200)
links.new(u, coordinates.inputs['X'])
links.new(wrapped_v, coordinates.inputs['Y'])
texture = node('ShaderNodeTexImage', 'Same mask as Unity', 2870, 200)
texture.image = bpy.data.images.get('SignalText.png') or bpy.data.images.load(str(character_dir / 'textures/SignalText.png'))
texture.image.colorspace_settings.name = 'Non-Color'
texture.image.filepath = '//textures/SignalText.png'
texture.image.pack()
texture.interpolation = 'Linear'
texture.extension = 'CLIP'
links.new(coordinates.outputs[0], texture.inputs['Vector'])
mix = node('ShaderNodeMixRGB', 'Unity body and text colours', 3120, 200)
mix.blend_type = 'MIX'
mix.inputs[1].default_value = (0.0027089783, 0.00061919505, 1, 1)
mix.inputs[2].default_value = (1, 1, 1, 1)
links.new(texture.outputs['Color'], mix.inputs[0])
emission = node('ShaderNodeEmission', 'Unlit silhouette', 3350, 200)
emission.inputs['Strength'].default_value = 1
links.new(mix.outputs[0], emission.inputs['Color'])
output = node('ShaderNodeOutputMaterial', 'Surface', 3570, 200)
links.new(emission.outputs[0], output.inputs['Surface'])

# Match Unity's 32-degree vertical field of view. Camera-space UVs remain stable
# when the viewport is resized or the camera view is zoomed in the editor.
camera = scene.camera
camera.data.type = 'PERSP'
camera.data.sensor_fit = 'VERTICAL'
camera.data.sensor_height = 24
camera.data.lens = 24 / (2 * math.tan(math.radians(32) / 2))
camera.location = (0, -4.5, 1.4)
camera.rotation_euler = (Vector((0, 0, 0.9)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.engine = 'BLENDER_EEVEE'
scene.eevee.use_taa_reprojection = False
scene.eevee.taa_samples = 32
scene.eevee.taa_render_samples = 64
scene.render.use_motion_blur = False
scene.render.resolution_percentage = 100
scene.frame_set(160)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.shading.type = 'MATERIAL'
            space.region_3d.view_perspective = 'CAMERA'
            space.region_3d.view_camera_zoom = 8
            space.overlay.show_overlays = False
scene['preview_text_projection'] = 'Unity perspective projection; 1.25 x 2 m; animated hip anchor'
scene['preview_text_temporal_reprojection'] = False
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(character_dir / 'Remy.blend'), compress=True)
print('Updated Unity-matched text preview; temporal reprojection and motion blur off.')
