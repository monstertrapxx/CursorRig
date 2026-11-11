import json, random, string, trimesh, sys, os, shutil
OUT=sys.argv[1]  # default-rigs dir
SRC='/tmp/cr/out'
def rid(p): return p+'_'+''.join(random.choice(string.ascii_lowercase+string.digits) for _ in range(7))
random.seed(11)
def att(**k):
    d=dict(id=rid('att'),name='',kind='primitive',shape='sphere',model=None,fit=True,useColor=True,color='#d8c8a2',metalness=0,roughness=0.9,opacity=1,emissive='#000000',emissiveIntensity=0,flatShading=False,thickness=0.3,position=[0,0,0],rotation=[0,0,0],scale=[1,1,1],visible=True)
    d.update(k); return d
def seg(name,parent,length,mass,atts):
    return dict(id=rid('seg'),name=name,parent=parent,length=length,rest=[0,0,0,1],stiffness=0,mass=mass,attachments=atts)
MODELS=[ # id,name,file,out filename,scale,spin
 ('fatty','Fatty the Lion','fatty.glb',1.45,30,'#8a8a8a'),
 ('edwin','Edwin the Flamingo','edwin.glb',1.5,30,'#8a8a8a'),
 ('longman','Longman','longman.glb',1.7,25,'#8a8a8a'),
 ('kurimu','Kurimu','kurimu.glb',1.3,30,'#8a8a8a'),
 ('waspclay','Wasp (clay)','wasp_clay.glb',1.2,0,None),
 ('forceps','Forceps Symbol','forceps_symbol.glb',1.1,0,None),
 ('longmanflat','Longman (low-poly)','longman_flat.glb',1.7,25,None),
 ('kurimu3','Kurimu (glow)','kurimu3.glb',1.4,30,None),
 ('popoy','Popoy','popoy.glb',1.4,30,'#8a8a8a'),
 ('badsanta','Bad Santa','santa.glb',1.5,30,'#8a8a8a'),
 ('ninjagray','Ninja Gray','ninja.glb',1.5,30,'#8a8a8a'),
]
EXTRA={'kurimu3':dict(useColor=True,color='#8fd97a',roughness=0.6,metalness=0.0,emissive='#5dff8a',emissiveIntensity=0.4,glow=2.0),
       'waspclay':dict(useColor=True,color='#c9a24b',roughness=0.8,metalness=0.0),
       'forceps':dict(useColor=True,color='#d9dce3',roughness=0.2,metalness=1.0)}
ONLY=sys.argv[2:]
for id_,name,f,s,spin,_ in MODELS:
    if ONLY and id_ not in ONLY: continue
    p=os.path.join(SRC,f)
    sc=trimesh.load(p); ext=sc.extents; hn=ext[1]/max(ext); 
    segs=[]; prev=None
    for i in range(5):
        sg=seg(f'string {i+1}',prev,0.4,0.6,[att(name='string',shape='cylinder',position=[0,-0.2,0],scale=[0.035,0.41,0.035],color='#c9ccd4',metalness=0.6,roughness=0.35)])
        segs.append(sg); prev=sg['id']
    L=0.22
    ex=EXTRA.get(id_,{})
    m=att(name=name,kind='model',model=f,useColor=ex.get('useColor',False),color=ex.get('color','#c8c8c8'),metalness=ex.get('metalness',0.2),roughness=ex.get('roughness',0.5),position=[0,-0.04-0.5*hn*s,0],scale=[s,s,s])
    for k in('emissive','emissiveIntensity','glow'):
        if k in ex: m[k]=ex[k]
    if spin: m['spin']=spin; m['spinDrive']=0.5
    knot=att(name='knot',shape='sphere',position=[0,-0.02,0],scale=[0.09,0.09,0.09],color='#c9ccd4',metalness=0.6,roughness=0.35)
    segs.append(seg(name,prev,L,6,[knot,m]))
    rig=dict(format='cursor-rig',version=1,id=id_,name=name,scale=46,physics=dict(gravity=34,damping=0.02,iterations=16,substeps=6,flatten=0.15,depthSway=0.3),anchor=dict(offset=[0,0,0],attachments=[]),segments=segs)
    json.dump(rig,open(os.path.join(OUT,id_+'.json'),'w'),indent=1)
    os.makedirs(os.path.join(OUT,'models'),exist_ok=True)
    shutil.copy(p,os.path.join(OUT,'models',f))
    print(id_,[round(x,2) for x in ext],'hn',round(hn,2))
