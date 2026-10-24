# Project notes

## 2026-10-24 — Leonarda's character branch

- Character authoring lives in `ArtSource/Characters/Remy`, outside Unity's `Assets` directory so opening the game does not trigger Blender source conversion.
- Leonarda can preview and edit the character using its standalone Blender file or the saved PNG. No local Unity project is required for that workflow.
- `Assets/_Project/Prefabs/Characters/Remy.prefab` contains only the character, animation, and appearance component. Integrate it with the existing scene's controllers.
- The original Mixamo Remy FBX is retained. The game export joins the seven source meshes into one skinned silhouette, preserving the rig and clothing outline.
- Binary art is tracked with Git LFS. Unity asset GUID metadata is retained.
- Desktop Unity 6 URP import, animation, attachment, ground alignment, and material rendering were checked locally.
- Corrected the Blender text preview to use Unity's camera-space projection, physical text size, animated hip anchor, scroll, and jitter. Disabled temporal reprojection to remove ghosted letters during playback. Verified the material in the live viewport and rendered standing and crouched poses; the hip drivers follow the rig correctly.
- Pending team checks: OpenXR stereo behavior, Quest performance, and integration with the game's movement/Animator states. The text is placeholder copy.
