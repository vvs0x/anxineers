# Remy

A clothed human silhouette with a flat cobalt blue body and camera-facing white text. The top, shorts, shoes, and hair retain Remy's original outline.

![Remy silhouette preview](previews/remy.png)

## Preview and edit without Unity

- **Quick look:** open `previews/remy.png`.
- **Animated 3D preview:** open `Remy.blend` in Blender. Press **Space** to play or pause the Scared motion. Material Preview shows the blue/text effect. The file contains this character and a small preview stage.
- **Original download:** `original/Remy@Scared.fbx` is unchanged.

The editable `.blend` includes the text texture. Unused imported meshes and textures were removed from this working copy. The preview stage stays in Blender and is excluded from the game export.

## Character data

- One skinned mesh, 19,404 Blender vertices, 67 bones.
- Clothing and accessories share the same skin so they stay attached during animation.
- Standing height is approximately 1.8 metres.
- Scared animation: frames 1–321 at 30 fps, approximately 10.67 seconds.
- Text is original placeholder copy and can be replaced independently of the character.

## Update the game asset

From the repository root, with Blender on your PATH:

```sh
blender --background ArtSource/Characters/Remy/Remy.blend --python ArtSource/Characters/Remy/tools/export_fbx.py
```

On macOS, `/Applications/Blender.app/Contents/MacOS/Blender` can be used in place of `blender`.

This updates `Assets/_Project/Art/Characters/Remy/Models/RemyGameReady.fbx`, preserving its existing Unity `.meta` file. Make model edits in Blender, save this source file, then export. Unity does not need to run on Leonarda's machine.

The source text image is `textures/SignalText.png`. Its game copy is under `Assets/_Project/Art/Characters/Remy/Textures/`. If you replace it, reload the image in Blender and repack it before saving the `.blend`.

## Add to the existing game scene

Use `Assets/_Project/Prefabs/Characters/Remy.prefab`. The prefab includes:

- The clothed model and Humanoid Avatar.
- An Animator with the Scared clip.
- The blue/text material and `SignalAppearance`, which anchors the text to the animated hips.

The game scene supplies its own movement, collisions, and camera. Keep the character's `SignalAppearance` component if using the projected text. The Scared clip has root motion disabled and its ground reference based on the feet. Normal walking and running require locomotion clips in the game's Animator.

The effect was tested in **Unity 6000.6.7f1 / URP 17.6.0 on desktop**. The repository targets Quest/OpenXR; stereo rendering and headset performance still need verification in the team's scene. The Blender material is a preview: FBX carries geometry, skinning, and animation, while the text effect uses the supplied Unity shader.

Keep all `.meta` files when moving or copying the character assets; they preserve prefab, material, and animation references.

## Validation

The Humanoid Avatar and shader validated successfully. Animation playback, movement, floor collision, and front/side appearance were checked in the local preview project. Hair and shoe attachment problems from the original multipart import were fixed by exporting one unified skin from Blender. The local test scene, Unity caches, MCP configuration, and diagnostic logs are not part of this branch.
