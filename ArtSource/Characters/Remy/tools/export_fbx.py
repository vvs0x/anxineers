"""Export the character from Remy.blend without opening Unity."""
from pathlib import Path
import bpy

repo = Path(__file__).resolve().parents[4]
target = repo / 'Assets/_Project/Art/Characters/Remy/Models/RemyGameReady.fbx'
rig = bpy.data.objects.get('SignalCharacter_Rig')
if rig is None or rig.type != 'ARMATURE':
    raise RuntimeError('Open ArtSource/Characters/Remy/Remy.blend before running this exporter.')
if not rig.animation_data or not rig.animation_data.action:
    raise RuntimeError('Remy has no active animation to export.')

scene = bpy.context.scene
previous_frame = scene.frame_current
scene.frame_set(scene.frame_start)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for child in rig.children_recursive:
    if child.type == 'MESH':
        child.select_set(True)
if rig.parent:
    rig.parent.select_set(True)
bpy.context.view_layer.objects.active = rig
target.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.fbx(
    filepath=str(target), use_selection=True,
    object_types={'ARMATURE', 'MESH', 'EMPTY'},
    global_scale=1.0, apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL',
    axis_forward='-Z', axis_up='Y', use_mesh_modifiers=True, mesh_smooth_type='FACE',
    add_leaf_bones=False, use_armature_deform_only=False,
    bake_anim=True, bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False,
    bake_anim_simplify_factor=0.0, path_mode='AUTO', embed_textures=False,
)
scene.frame_set(previous_frame)
print('Exported Remy:', target)
