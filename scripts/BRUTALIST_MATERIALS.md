# Original Blender material export

`bake_brutalist_materials.py` reads `../brutalist_A_final.blend`, relative to
the repository, and never saves that file. Run it with Blender's automatic
script execution disabled:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --disable-autoexec \
  --python scripts/bake_brutalist_materials.py
```

The export selects the same authored objects as the existing FBX. It evaluates
the original geometry modifiers, preserves object coordinates, and exports
metres with the standard glTF Y-up conversion `(x, z, -y)`. There is no mesh
simplification. Empty evaluated meshes are omitted. `windows.001` is separated
into `windows_frame` and `windows_glass` so the frame can cast shadows without
making the glass opaque to sunlight.

Concrete, marble and sculptural metal use the author's procedural node graphs.
Base color, roughness/metalness and tangent normals are baked by Cycles onto
three shared nonoverlapping UV atlases. Original shader UV coordinates remain
available during baking. No replacement textures or generic concrete shader is
used. Architecture is 2048px and floor/props are 1024px; ORM maps use half that
resolution. The nine textures require about 72 MiB as RGBA textures with mipmaps.

Simple authored metal, light and plastic materials remain regular PBR
materials. Original light emission is preserved. The glass shader contains a
Cycles-only camera/shadow-ray switch; its web PBR material retains the original
camera-ray glass color, roughness and IOR, with full transmission. The runtime
must suppress the glass mesh's shadow. Four offsite objects already hidden by
the web environment remain in the export but do not use atlas space.

Outputs are `web/public/environments/brutalist/room-textured.glb` and
`materials/manifest.json`, plus the standalone atlas PNGs for inspection. The
manifest records the source hash, unchanged-source check, mesh names/counts,
material assignments and atlas resolutions. The GLB embeds the required maps;
the browser does not need to load the standalone PNGs separately. If the full
GLB is above 25 MB, the script enables Blender's `EXT_meshopt_compression`
export without simplifying topology (runtime needs `MeshoptDecoder`).

The original packed HDR and a bake of the authored World shader are exported
by `export-brutalist-lighting.py` into the sibling `daylight/` directory.
`-- --preview --samples 4` exports a 256px floor proof before a complete bake.

Validate the exported geometry, atlas channels, authored glass settings, texture
memory budget and unchanged source with:

```sh
node scripts/validate_brutalist_asset.mjs
```

An optional uncompressed GLB argument also checks compression bounds within
0.1 mm. The completed export measured 18.37 MB, 72 MiB of atlas memory including
mipmaps, and less than 0.001 mm of bounds difference after meshopt compression.
