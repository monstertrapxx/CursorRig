# Makes one cursorchain per baked Bloody Shooting model. Usage: python3 make_bloody_shooting.py <baked-dir> <default-rigs-dir>
import json, random, string, trimesh, sys, os, shutil, glob
SRC, OUT = sys.argv[1], sys.argv[2]
random.seed(23)
def rid(p): return p+'_'+''.join(random.choice(string.ascii_lowercase+string.digits) for _ in range(7))
def att(**k):
    d=dict(id=rid('att'),name='',kind='primitive',shape='sphere',model=None,fit=True,useColor=True,color='#d8c8a2',metalness=0,roughness=0.9,opacity=1,emissive='#000000',emissiveIntensity=0,flatShading=False,thickness=0.3,position=[0,0,0],rotation=[0,0,0],scale=[1,1,1],visible=True)
    d.update(k); return d
def seg(name,parent,length,mass,atts):
    return dict(id=rid('seg'),name=name,parent=parent,length=length,rest=[0,0,0,1],stiffness=0,mass=mass,attachments=atts)
os.makedirs(os.path.join(OUT,'models'),exist_ok=True)
for p in sorted(glob.glob(os.path.join(SRC,'*.glb'))):
    stem=os.path.basename(p)[:-4]
    name=' '.join(w.capitalize() if w.lower() not in ('ui','m16') else w.upper() for w in stem.split('_'))
    sc=trimesh.load(p); ex,ey,ez=[float(v) for v in sc.extents]
    rot=[0,0,0]; spin=25
    horiz=max(ex,ez)
    if ey < 0.3*horiz:                 # a flat plate: stand it up so it faces the viewer
        rot=[90,0,0]; ex,ey,ez=ex,ez,ey; spin=0
    elif ez > 1.4*max(ex,ey):          # long front-to-back (a gun): turn it side-on
        rot=[0,90,0]; ex,ey,ez=ez,ey,ex; spin=0
    m=max(ex,ey,ez); hn=ey/m
    s=1.4 if spin else 1.25
    mid='bs_'+stem.lower()
    segs=[]; prev=None
    for i in range(5):
        sg=seg(f'string {i+1}',prev,0.4,0.6,[att(name='string',shape='cylinder',position=[0,-0.2,0],scale=[0.035,0.41,0.035],color='#c9ccd4',metalness=0.6,roughness=0.35)])
        segs.append(sg); prev=sg['id']
    L=0.22
    model=att(name=name,kind='model',model=mid+'.glb',useColor=False,color='#c8c8c8',metalness=0.2,roughness=0.5,position=[0,-0.04-0.5*hn*s,0],rotation=rot,scale=[s,s,s])
    if spin: model['spin']=spin; model['spinDrive']=0.5
    knot=att(name='knot',shape='sphere',position=[0,-0.02,0],scale=[0.09,0.09,0.09],color='#c9ccd4',metalness=0.6,roughness=0.35)
    segs.append(seg(name,prev,L,6,[knot,model]))
    rig=dict(format='cursor-rig',version=1,id=mid,name=name,scale=46,physics=dict(gravity=28,damping=0.02,iterations=16,substeps=6,flatten=0.15,depthSway=0.3),anchor=dict(offset=[0,0,0],attachments=[]),segments=segs)
    json.dump(rig,open(os.path.join(OUT,mid+'.json'),'w'),indent=1)
    shutil.copy(p,os.path.join(OUT,'models',mid+'.glb'))
print('done')
