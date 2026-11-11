import trimesh, numpy as np
from scipy.ndimage import gaussian_filter, zoom
from skimage import measure
m=trimesh.load('/root/.claude/uploads/34603d08-b118-5cde-bf26-103b23158c8a/1d031775-wasp_clay.stl')
pitch=0.035
vg=m.voxelized(pitch).fill()
A=vg.matrix.astype(float)
A=np.pad(A,8)
S=gaussian_filter(A,(2.6,2.6,1.6))
S=gaussian_filter(S,1.0)
v,f,n,_=measure.marching_cubes(S,level=0.40)
v=v*pitch+vg.translation-8*pitch
mesh=trimesh.Trimesh(v,f); mesh.merge_vertices()
trimesh.smoothing.filter_taubin(mesh,iterations=40)
# lumpy hand-pressed surface + faint fingerprint-ish noise
rng=np.random.default_rng(3)
p=mesh.vertices
def noise(freq,seed):
    r=np.random.default_rng(seed); k=r.normal(size=(3,))*freq; ph=r.uniform(0,6.28,3)
    return np.sin(p@k[:,None]*1.0+0).ravel()
disp=sum(np.sin(p[:,0]*a+p[:,1]*b+p[:,2]*c+ph)*w for a,b,c,ph,w in[(5,4,6,0.3,1),(8,11,7,1.7,0.6)])
nrm=mesh.vertex_normals
mesh.vertices=p+nrm*disp[:,None]*0.0
mesh.vertices=mesh.vertices-mesh.bounds.mean(0)
base=np.array([226,214,190])/255.0
var=1+rng.normal(0,0.006,len(disp))
col=np.clip(base[None,:]*var[:,None],0,1)
col=np.clip(np.round(255*col**2.2),0,255).astype(np.uint8)
mesh.visual=trimesh.visual.ColorVisuals(mesh,vertex_colors=np.c_[col,np.full(len(col),255,np.uint8)])
mesh.export('/tmp/cr/out/wasp_clay_smooth2.glb')
print(len(mesh.faces),mesh.extents)
