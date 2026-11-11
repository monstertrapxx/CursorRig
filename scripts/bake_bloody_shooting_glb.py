import bpy, sys, os
src, dst = sys.argv[1], sys.argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arms=[o for o in bpy.data.objects if o.type=='ARMATURE']
for a in arms: a.data.pose_position='REST'
bpy.context.view_layer.update()
dg=bpy.context.evaluated_depsgraph_get()
new=[]
for o in list(bpy.data.objects):
    if o.type!='MESH' or o.name.startswith('Icosphere'): continue
    ev=o.evaluated_get(dg); me=bpy.data.meshes.new_from_object(ev,depsgraph=dg)
    n=bpy.data.objects.new(o.name,me); bpy.context.scene.collection.objects.link(n)
    n.matrix_world=o.matrix_world.copy()
    for m in o.data.materials: n.data.materials.append(m)
    new.append(n)
for o in list(bpy.data.objects):
    if o not in new: bpy.data.objects.remove(o)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
for n in new:
    n.vertex_groups.clear(); n.parent=None
bpy.ops.object.select_all(action='DESELECT')
for n in new: n.select_set(True)
bpy.context.view_layer.objects.active=new[0]
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_animations=False, export_skins=False)
print('BAKED',os.path.basename(dst),os.path.getsize(dst),len(new),'meshes', 'armatures',len(arms))
