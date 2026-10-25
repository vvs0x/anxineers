"""Merge supplied baked mesh UVs/maps into the gallery, retaining authored node transforms.
Run from any directory with python3. Original exports remain unchanged.
"""
from pathlib import Path
import copy
import json
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'web/public/environments/brutalist'
SOURCE = ROOT.parent / 'brutalist_baked'

def read(path):
    data = path.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20+size]), data[28+size:]

base, binary = read(DEST / 'room-textured.glb')
baked, bake_binary = read(SOURCE / 'model.glb')
blobs = [binary, bake_binary]
# Keep only referenced binary slices in the resulting file.
for view in base['bufferViews']:
    view['_source'] = 0
cache = {}
def take(kind, index):
    key = (kind, index)
    if key in cache:
        return cache[key]
    item = copy.deepcopy(baked[kind][index])
    if kind == 'accessors':
        item['bufferView'] = take('bufferViews', item['bufferView'])
    elif kind == 'bufferViews':
        item['_source'] = 1
    elif kind == 'images':
        item['bufferView'] = take('bufferViews', item['bufferView'])
    elif kind == 'textures':
        item['source'] = take('images', item['source'])
        if 'sampler' in item:
            item['sampler'] = take('samplers', item['sampler'])
    elif kind == 'materials':
        item['pbrMetallicRoughness']['baseColorTexture']['index'] = take('textures', item['pbrMetallicRoughness']['baseColorTexture']['index'])
    target = base.setdefault(kind, [])
    cache[key] = len(target)
    target.append(item)
    return len(target)-1

names = json.loads((SOURCE / 'bake.json').read_text())['objects']
updated = []
for node in base['nodes']:
    name = node.get('name')
    if name not in names:
        continue
    source = next(n for n in baked['nodes'] if n.get('name') == name)
    mesh = copy.deepcopy(baked['meshes'][source['mesh']])
    old = base['meshes'][node['mesh']]
    for i, primitive in enumerate(mesh['primitives']):
        primitive['attributes'] = {key: take('accessors', value) for key, value in primitive['attributes'].items()}
        primitive['indices'] = take('accessors', primitive['indices'])
        material = baked['materials'][primitive['material']]
        old_material = old['primitives'][min(i,len(old['primitives'])-1)]['material']
        if material.get('name', '').startswith('baked_'):
            primitive['material'] = take('materials', primitive['material'])
        else:
            primitive['material'] = old_material
    # Mesh-local coordinates match; node transforms in the supplied file can
    # be parent-relative, so keep the current gallery's flattened transforms.
    base['meshes'][node['mesh']] = mesh
    updated.append(name)

# Compact unreferenced arrays and buffers, including the replaced texture atlases.
used = {k:set() for k in ['meshes','accessors','materials','textures','images','samplers','bufferViews']}
def visit(kind, index):
    if index in used[kind]: return
    used[kind].add(index)
    obj = base[kind][index]
    if kind == 'meshes':
        for p in obj['primitives']:
            for a in p['attributes'].values(): visit('accessors', a)
            if 'indices' in p: visit('accessors', p['indices'])
            if 'material' in p: visit('materials', p['material'])
    elif kind == 'accessors' and 'bufferView' in obj: visit('bufferViews', obj['bufferView'])
    elif kind == 'materials':
        def walk(value):
            if not isinstance(value,dict): return
            for key,v in value.items():
                if key.endswith('Texture') and isinstance(v,dict): visit('textures',v['index'])
                else: walk(v)
        walk(obj)
    elif kind == 'textures':
        visit('images',obj['source'])
        if 'sampler' in obj: visit('samplers',obj['sampler'])
    elif kind == 'images' and 'bufferView' in obj: visit('bufferViews',obj['bufferView'])
for n in base['nodes']:
    if 'mesh' in n: visit('meshes',n['mesh'])
remap={k:{old:new for new,old in enumerate(sorted(ids))} for k,ids in used.items()}
for n in base['nodes']:
    if 'mesh' in n: n['mesh']=remap['meshes'][n['mesh']]
for k,ids in used.items(): base[k]=[base[k][i] for i in sorted(ids)]
for m in base['meshes']:
    for p in m['primitives']:
        p['attributes']={k:remap['accessors'][i] for k,i in p['attributes'].items()}
        for key,kind in [('indices','accessors'),('material','materials')]:
            if key in p: p[key]=remap[kind][p[key]]
for a in base['accessors']:
    if 'bufferView' in a: a['bufferView']=remap['bufferViews'][a['bufferView']]
def remap_textures(value):
    if not isinstance(value,dict): return
    for key,v in value.items():
        if key.endswith('Texture') and isinstance(v,dict): v['index']=remap['textures'][v['index']]
        else: remap_textures(v)
for m in base['materials']: remap_textures(m)
for t in base['textures']:
    t['source']=remap['images'][t['source']]
    if 'sampler' in t:t['sampler']=remap['samplers'][t['sampler']]
for i in base['images']:
    if 'bufferView' in i:i['bufferView']=remap['bufferViews'][i['bufferView']]
result=bytearray()
for view in base['bufferViews']:
    source=blobs[view.pop('_source')]
    compressed=view.get('extensions',{}).get('EXT_meshopt_compression')
    if compressed:
        offset=compressed.get('byteOffset',0)
        result.extend(b'\0' * (-len(result)%4))
        compressed['byteOffset']=len(result)
        compressed['buffer']=0
        result.extend(source[offset:offset+compressed['byteLength']])
        view['buffer']=1
        continue
    offset=view.get('byteOffset',0)
    result.extend(b'\0' * (-len(result)%4))
    view['byteOffset']=len(result)
    result.extend(source[offset:offset+view['byteLength']])
result.extend(b'\0' * (-len(result)%4))
base['buffers']=[{'byteLength':len(result)}, {'byteLength':max((v.get('byteOffset',0)+v['byteLength'] for v in base['bufferViews'] if v.get('buffer')==1),default=0), 'extensions':{'EXT_meshopt_compression':{'fallback':True}}}]
header=json.dumps(base,separators=(',',':')).encode()
header+=b' ' * (-len(header)%4)
output=struct.pack('<III',0x46546c67,2,28+len(header)+len(result))+struct.pack('<II',len(header),0x4e4f534a)+header+struct.pack('<II',len(result),0x004e4942)+result
(DEST/'room-baked.glb').write_bytes(output)
subprocess.run(['node', str(ROOT / 'scripts/align-baked-geometry.mjs')], check=True)
print(f'Integrated {len(updated)} baked objects ({len(output)/1024/1024:.1f} MiB): {", ".join(updated)}')
