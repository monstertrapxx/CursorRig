"""3D version of ragdoll.py (segments may point in any direction) - used for the animals."""
import json, copy, math
import numpy as np, trimesh
from ragdoll import uid
DOWN=np.array([0.,-1.,0.])
def qfrom(d):
    d=np.asarray(d,float); d=d/np.linalg.norm(d)
    c=float(np.dot(DOWN,d))
    if c<-0.999999: return np.array([1.,0,0,0])        # x,y,z,w : 180 deg about X
    ax=np.cross(DOWN,d); w=1+c; q=np.array([ax[0],ax[1],ax[2],w]); return q/np.linalg.norm(q)
def qmul(a,b):
    x1,y1,z1,w1=a; x2,y2,z2,w2=b
    return np.array([w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2, w1*w2-x1*x2-y1*y2-z1*z2])
def qinv(q): return np.array([-q[0],-q[1],-q[2],q[3]])
def qmat(q):
    x,y,z,w=q
    return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])

def export_parts(meshes, vparts, segs, K, imgs, outdir, prefix, vsets=None):
    parts={}
    for mi,m in enumerate(meshes):
        vp=vparts[mi]; vs=vsets[mi] if vsets else None
        for f in m['F']:
            ps={vp[i] for i in f if vp[i]}
            if vs:
                for i in f: ps|=vs[i]
            for p in ps:
                if p in segs: parts.setdefault(p,{}).setdefault(mi,[]).append(f)
    for p,bymesh in parts.items():
        s=segs[p]; R=qmat(qinv(s['q_orig'])); st=np.array(s['start'])
        sc=trimesh.Scene()
        for mi,faces in bymesh.items():
            m=meshes[mi]; vid={}; V=[];N=[];UV=[];F=[]
            for f in faces:
                tri=[]
                for i in f:
                    if i not in vid:
                        vv=m['V'][i]; vid[i]=len(V)
                        V.append(R@(np.array(vv[0])-st)*K); N.append(R@np.array(vv[1])); UV.append([vv[3][0][0],vv[3][0][1]])
                    tri.append(vid[i])
                F.append(tri)
            mat=trimesh.visual.material.PBRMaterial(baseColorTexture=imgs[m['tex'][0]],roughnessFactor=0.7,metallicFactor=0,doubleSided=True)
            sc.add_geometry(trimesh.Trimesh(np.array(V),np.array(F),vertex_normals=np.array(N),process=False,visual=trimesh.visual.TextureVisuals(uv=np.array(UV),material=mat)),node_name=f'{p}_{mi}')
        sc.export(f'{outdir}/{prefix}_{p}.glb')
    return list(parts)

def build_rig(base_rig, rid, name, prefix, K, seglist, scale=46, flatten=0.02):
    r=copy.deepcopy(base_rig); r['id']=rid; r['name']=name; r['scale']=scale
    segs=r['segments'][:4]
    tmpl=[a for s in base_rig['segments'] for a in s['attachments'] if a['kind']=='model'][0]
    ids={None:segs[3]['id']}; qh={None:np.array([0,0,0,1.])}
    for sd in seglist:
        o=np.array(sd['end'])-np.array(sd['start']); L=float(np.linalg.norm(o))
        q_o=qfrom(o); q_h=qfrom(sd['hang']) if sd.get('hang') is not None else q_o
        rel=qmul(qinv(qh[sd['parent']]),q_h)
        s={'id':uid('seg'),'name':sd['name'],'parent':ids[sd['parent']],'length':round(max(L,0.02)*K,4),'rest':[round(float(v),6) for v in rel],'stiffness':sd.get('stiff',0),'mass':sd.get('mass',1),'attachments':[]}
        if sd.get('limit'): s['limit']=sd['limit']
        if sd.get('part'):
            a=copy.deepcopy(tmpl); a.update(id=uid('att'),name=sd['name'],model=f"{prefix}_{sd['part']}.glb",fit=False,useColor=False,position=[0,0,sd.get('dz',0)],rotation=[0,0,0],scale=[1,1,1],visible=True,noSpin=True); a.pop('spin',None); a.pop('spinDrive',None)
            s['attachments']=[a]
        segs.append(s); ids[sd['name']]=s['id']; qh[sd['name']]=q_h
    r['segments']=segs; r['physics'].update(gravity=30,damping=0.03,iterations=30,substeps=6,flatten=flatten,yaw=True)
    return r
