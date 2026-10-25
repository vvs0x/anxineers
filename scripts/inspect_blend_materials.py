import bpy, json
from pathlib import Path
source=Path('/Users/leonarda/Documents/CODING/art-hack/brutalist_A_final.blend')
bpy.ops.wm.open_mainfile(filepath=str(source))
def val(v):
 try:return list(v)
 except:return v if isinstance(v,(str,int,float,bool)) else str(v)
materials=[]
for m in bpy.data.materials:
 nodes=[]
 if m.use_nodes:
  for n in m.node_tree.nodes:
   nodes.append({'name':n.name,'type':n.type,'group':n.node_tree.name if n.type=='GROUP' and n.node_tree else None,'image':n.image.name if n.type=='TEX_IMAGE' and n.image else None,'inputs':{i.name:val(i.default_value) for i in n.inputs if hasattr(i,'default_value')},'links':[(i.name,l.from_node.name,l.from_socket.name) for i in n.inputs for l in i.links]})
 materials.append({'name':m.name,'users':m.users,'nodes':nodes})
report={'scene':bpy.context.scene.name,'render_engine':bpy.context.scene.render.engine,'unit_scale':bpy.context.scene.unit_settings.scale_length,'images':[{'name':i.name,'path':i.filepath,'packed':bool(i.packed_file),'size':list(i.size),'source':i.source} for i in bpy.data.images],'meshes':[{'name':o.name,'data':o.data.name,'verts':len(o.data.vertices),'polys':len(o.data.polygons),'uv':[u.name for u in o.data.uv_layers],'materials':[m.name if m else None for m in o.data.materials],'matrix':[list(r) for r in o.matrix_world],'dimensions':list(o.dimensions),'hidden':o.hide_render} for o in bpy.context.scene.objects if o.type=='MESH'],'materials':materials,'groups':[{'name':g.name,'nodes':[(n.name,n.type) for n in g.nodes]} for g in bpy.data.node_groups]}
p=Path(__file__).resolve().parent/'brutalist-material-inspection.json';p.write_text(json.dumps(report,indent=2))
print('REPORT',p);print('IMAGES',report['images']);print('MATERIALS',[(m['name'],m['users'],[(n['name'],n['type'],n['group']) for n in m['nodes']]) for m in materials]);print('MESHES',[(o['name'],o['verts'],o['uv'],o['materials']) for o in report['meshes']])
