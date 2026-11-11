import bpy, sys, os, json
a = sys.argv[1:]
src, out, opt = a[0], a[1], json.loads(a[2])
bpy.ops.wm.open_mainfile(filepath=src)
for o in list(bpy.data.objects):
    if o.type=='ARMATURE': o.data.pose_position='REST'
for o in bpy.data.objects:
    for m in o.modifiers:
        if m.type=='SUBSURF':
            m.show_viewport=(opt.get('sublv',1)>0); m.levels=opt.get('sublv',1); m.render_levels=opt.get('sublv',1)
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
keep=[]
for o in list(bpy.data.objects):
    if o.type!='MESH' or o.name in opt.get('drop',[]) or o.hide_viewport: continue
    if opt.get('only') and o.name not in opt['only']: continue
    ev=o.evaluated_get(dg); me=bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    n=bpy.data.objects.new(o.name+'_b', me); bpy.context.scene.collection.objects.link(n)
    n.matrix_world=o.matrix_world.copy(); keep.append((o,n))
# materials fallbacks
for o,n in keep:
    pass
for o,n in keep:
    bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT')
for o,n in keep:
    n.select_set(True)
bpy.context.view_layer.objects.active=keep[0][1]
for o,n in keep:
    # drop vertex groups
    n.vertex_groups.clear()
r=opt.get('decimate')
if r:
    for o,n in keep:
        if len(n.data.polygons)>3000:
            m=n.modifiers.new('d','DECIMATE'); m.ratio=r
            bpy.context.view_layer.objects.active=n
            bpy.ops.object.modifier_apply(modifier='d')
for mname,spec in opt.get('mats',{}).items():
    for m in bpy.data.materials:
        if m.name==mname or mname=='*':
            m.use_nodes=True
            if spec.get('flat'):
                for nd in list(m.node_tree.nodes):
                    if nd.type not in ('OUTPUT_MATERIAL',): m.node_tree.nodes.remove(nd)
                bsdf=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled'); mo=[x for x in m.node_tree.nodes if x.type=='OUTPUT_MATERIAL']
                if not mo: mo=[m.node_tree.nodes.new('ShaderNodeOutputMaterial')]
                m.node_tree.links.new(bsdf.outputs['BSDF'],mo[0].inputs['Surface'])
            if spec.get('img'):
                im=bpy.data.images.load(spec['img']); 
                for nd in list(m.node_tree.nodes):
                    if nd.type not in ('OUTPUT_MATERIAL',): m.node_tree.nodes.remove(nd)
                bsdf=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled'); mo=[x for x in m.node_tree.nodes if x.type=='OUTPUT_MATERIAL'][0]
                tx=m.node_tree.nodes.new('ShaderNodeTexImage'); tx.image=im
                m.node_tree.links.new(tx.outputs['Color'],bsdf.inputs['Base Color']); m.node_tree.links.new(bsdf.outputs['BSDF'],mo.inputs['Surface'])
            bs=[x for x in m.node_tree.nodes if x.type=='BSDF_PRINCIPLED']
            if not bs: continue
            b=bs[0]
            for l in list(m.node_tree.links):
                if l.to_socket==b.inputs['Base Color'] and spec.get('flat'): m.node_tree.links.remove(l)
            if 'color' in spec:
                c=spec['color']; b.inputs['Base Color'].default_value=[int(c[i:i+2],16)/255 for i in (1,3,5)]+[1]
            if 'metal' in spec: b.inputs['Metallic'].default_value=spec['metal']
            if 'rough' in spec: b.inputs['Roughness'].default_value=spec['rough']
mx=opt.get('maxtex',1024)
for im in bpy.data.images:
    if im.size[0]>mx and im.users:
        k=mx/max(im.size); im.scale(int(im.size[0]*k),int(im.size[1]*k))
tris=sum(len(n.data.polygons) for o,n in keep)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=False, export_image_format='JPEG' if opt.get('jpeg') else 'AUTO', export_jpeg_quality=85)
print('DONE',out,os.path.getsize(out),'polys',tris, 'images',[(i.name,i.size[:],i.has_data) for i in bpy.data.images if i.users])
