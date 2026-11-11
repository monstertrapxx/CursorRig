import bpy, sys, json, os, numpy as np
src=sys.argv[sys.argv.index('--')+1]; out=sys.argv[sys.argv.index('--')+2]; tex=sys.argv[sys.argv.index('--')+3]
bpy.ops.wm.open_mainfile(filepath=src)
arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]; ob=[o for o in bpy.data.objects if o.type=='MESH'][0]
M=arm.matrix_world
bones=[dict(name=b.name,parent=b.parent.name if b.parent else None,head=list(M@b.head_local),tail=list(M@b.tail_local)) for b in arm.data.bones]
me=ob.data; me.calc_loop_triangles(); mw=ob.matrix_world
vg={g.index:g.name for g in ob.vertex_groups}
V=[list(mw@v.co) for v in me.vertices]
W=[[(vg.get(g.group),float(g.weight)) for g in sorted(v.groups,key=lambda g:-g.weight)[:4] if vg.get(g.group)] for v in me.vertices]
uvl=me.uv_layers.active; loops=[];F=[]
for t in me.loop_triangles:
    F.append([len(loops)+k for k in range(3)]); loops+=list(t.loops)
Lv=[me.loops[l].vertex_index for l in loops]
dump=dict(bones=bones,meshes=[dict(name='m',V=[V[i] for i in Lv],N=[list((mw.to_3x3()@me.loops[l].normal).normalized()) for l in loops],UV=[list(uvl.data[l].uv) for l in loops],F=F,W=[W[i] for i in Lv],tex=tex,color=None)])
os.makedirs(out,exist_ok=True); json.dump(dump,open(out+'/dump.json','w'))
print('bones',[(b['name'],b['parent']) for b in bones]); print('bbox',np.min(V,0),np.max(V,0))
