import bpy, sys, json, os, numpy as np
src=sys.argv[sys.argv.index('--')+1]; out=sys.argv[sys.argv.index('--')+2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
# rest pose: bones in armature space then to world
M=arm.matrix_world
bones=[]
for b in arm.data.bones:
    h=M@b.head_local; t=M@b.tail_local
    bones.append(dict(name=b.name,parent=b.parent.name if b.parent else None,head=list(h),tail=list(t)))
meshes=[]; os.makedirs(out,exist_ok=True)
for o in bpy.data.objects:
    if o.type!='MESH': continue
    me=o.data; me.calc_loop_triangles()
    mw=o.matrix_world
    vg={g.index:g.name for g in o.vertex_groups}
    V=np.array([list(mw@v.co) for v in me.vertices],dtype=np.float32)
    W=[]
    for v in me.vertices:
        gs=sorted([(g.weight,vg.get(g.group)) for g in v.groups],reverse=True)
        W.append([(n,float(w)) for w,n in gs[:4] if n])
    # per-loop uv/normals -> split vertices by loop
    uvl=me.uv_layers.active
    loops=[];F=[]
    for tri in me.loop_triangles:
        F.append([len(loops)+k for k in range(3)])
        for li in tri.loops: loops.append(li)
    Lv=[me.loops[li].vertex_index for li in loops]
    UV=[list(uvl.data[li].uv) for li in loops] if uvl else [[0,0]]*len(loops)
    Ln=[list((mw.to_3x3()@me.loops[li].normal).normalized()) for li in loops]
    # one entry per material slot (a character often has skin, clothes... on different materials)
    slots=len(o.material_slots) or 1
    for si in range(slots):
        Fi=[F[k] for k,tri in enumerate(me.loop_triangles) if (tri.material_index if slots>1 else 0)==si]
        if not Fi: continue
        mat=o.material_slots[si].material if o.material_slots else None
        tex=None; col=None
        if mat and mat.use_nodes:
            for n in mat.node_tree.nodes:
                if n.type=='TEX_IMAGE' and n.image and not n.image.name.lower().replace('.png','').endswith('nor'):
                    tex=os.path.join(out,f'{o.name}_{si}_{n.image.name}.png')
                    try:
                        n.image.filepath_raw=tex; n.image.file_format='PNG'; n.image.save()
                    except Exception as e: tex=None
                    break
            for n in mat.node_tree.nodes:
                if n.type=='BSDF_PRINCIPLED': col=list(n.inputs['Base Color'].default_value)
        meshes.append(dict(name=f'{o.name}#{si}',V=V[Lv].tolist(),N=Ln,UV=UV,F=Fi,W=[W[i] for i in Lv],tex=tex,color=col))
json.dump(dict(bones=bones,meshes=meshes),open(os.path.join(out,'dump.json'),'w'))
print('bones',len(bones),'meshes',[(m['name'],len(m['V']),len(m['F']),m['tex']) for m in meshes])
