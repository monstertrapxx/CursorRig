import sys,io,contextlib,json; sys.path.insert(0,'/tmp/cr'); sys.path.insert(0,'/tmp/cr/rag')
import numpy as np, math
from PIL import Image
with contextlib.redirect_stdout(io.StringIO()): from xps import parse
import ragdoll as R
import io as _io
D='/mnt/user-data/uploads/Popoy (Dame Tu Cosita)/'
bones,meshes,_,_=parse(D+'xps.xps')
imgs={n:Image.open(D+n).convert('RGB') for n in ('popoy.png','WortEye.png')}
def _jpg(i):
    b=_io.BytesIO(); i.save(b,'JPEG',quality=88); b.seek(0); return Image.open(b)
for n,i in list(imgs.items()):
    if max(i.size)>1024: imgs[n]=i.resize((1024,int(i.size[1]*1024/i.size[0])) if i.size[0]>=i.size[1] else (int(i.size[0]*1024/i.size[1]),1024))
imgs={n:_jpg(i) for n,i in imgs.items()}
P=lambda i: np.array(bones[i][2])
b2p={}
for i in (39,40,41,42): b2p[i]='head'
for i in (0,1,2,3,4,5,6,7,23): b2p[i]='torso'
b2p[8]='armL_up'
for i in range(9,23): b2p[i]='armL_lo'
b2p[24]='armR_up'
for i in range(25,39): b2p[i]='armR_lo'
b2p[43]='legR_up'
for i in (44,45,46): b2p[i]='legR_lo'
b2p[47]='legL_up'
for i in (48,49,50): b2p[i]='legL_lo'
vparts=R.part_by_vertex(meshes,bones,b2p)
def _pof(bi):
    while bi>=0:
        if bi in b2p: return b2p[bi]
        bi=bones[bi][1]
    return None
THR=0.08
vsets=[]
for m in meshes:
    row=[]
    for v in m['V']:
        acc={}
        for b,w in zip(v[4],v[5]):
            p=_pof(b)
            if p: acc[p]=acc.get(p,0)+w
        row.append({p for p,w in acc.items() if w>=THR})
    vsets.append(row)

# --- clean joint cuts: shoulders and hips are cut by a plane square to the limb, with a thin overlap band, instead of by blended skin weights (those left torn, spiky edges)
_ytop=max(v[0][1] for m in meshes for v in m['V'])
TOL=0.022*_ytop; RAD=0.11*_ytop
def plane_cut(joint_bone, next_bone, up_part, lo_part):
    j=np.array(bones[joint_bone][2]); n=np.array(bones[next_bone][2]); a=n-j; a/=np.linalg.norm(a)
    for mi,m in enumerate(meshes):
        for i,v in enumerate(m['V']):
            p=np.array(v[0])-j; t=float(p@a); d=float(np.linalg.norm(p-t*a))
            cur=vparts[mi][i]
            if cur in (up_part,lo_part):
                if t<-TOL: vparts[mi][i]='torso'; vsets[mi][i]=set()
                elif t<TOL: vsets[mi][i]=set(vsets[mi][i])|{'torso',cur}
            elif cur=='torso' and t>-TOL and d<RAD:
                if t>TOL: vparts[mi][i]=up_part; vsets[mi][i]=set()
                else: vsets[mi][i]=set(vsets[mi][i])|{up_part,'torso'}
# shoulder cap: skin above the shoulder joint that is weighted to the upper arm goes with the torso, so it cannot flap off as a spiky sheet
for _b,_part in ((8,'armL_up'),(24,'armR_up')):
    _j=np.array(bones[_b][2]); _a=np.array(bones[_b+1][2])-_j if False else None
    for mi,m in enumerate(meshes):
        for i,v in enumerate(m['V']):
            if vparts[mi][i]==_part and v[0][1]-_j[1]>0.035 and abs(v[0][0]-_j[0])<0.25:
                vparts[mi][i]='torso'; vsets[mi][i]=set(vsets[mi][i])|{'torso'}
allv=np.array([v[0] for m in meshes for v in m['V']]); ytop=allv[:,1].max(); K=1.7/ytop
xn=P(39)[0]; yneck=P(39)[1]; yhip=P(3)[1]
neck=np.array([xn,yneck,P(39)[2]]); hips=np.array([xn,yhip,P(3)[2]]); top=np.array([xn,ytop,P(39)[2]])
def tip(part,start,d):    # furthest vertex of a part along direction d from start
    best=0
    for mi,m in enumerate(meshes):
        for i,v in enumerate(m['V']):
            if vparts[mi][i]==part: best=max(best,float(np.dot(np.array(v[0])-start,d)))
    return best
S={}   # part -> start/theta_orig
seglist=[]
def add(name,parent,part,start,end,**kw):
    seglist.append(dict(name=name,parent=parent,part=part,start=tuple(start),end=tuple(end),**kw))
    if part: S[part]=dict(start=tuple(start),theta_orig=R.ang(np.array(end[:2])-np.array(start[:2])))
add('head',None,'head',top,neck,stiff=0,mass=1)
add('torso','head','torso',neck,hips,stiff=0.35,limit=45,mass=1.2)
ALPHA=math.radians(34)
for sd,sg in (('L',1),('R',-1)):
    sh=P(8 if sd=='L' else 24); el=P(9 if sd=='L' else 25)
    add(f'{sd} shoulder','head',None,neck,sh,stiff=0.98,mass=0.3)
    hang=(sg*math.sin(ALPHA),-math.cos(ALPHA))
    add(f'{sd} upper arm',f'{sd} shoulder',f'arm{sd}_up',sh,el,hang=hang,stiff=0.12,limit=100,mass=0.6,dz=0.06)
    d=(el-sh)[:2]; d=d/np.linalg.norm(d); dd=np.array([d[0],d[1],0])
    endp=el+dd*tip(f'arm{sd}_lo',el,dd)
    add(f'{sd} forearm',f'{sd} upper arm',f'arm{sd}_lo',el,endp,stiff=0.08,limit=90,mass=0.5,dz=0.07)
    th=P(47 if sd=='L' else 43); kn=P(48 if sd=='L' else 44)
    add(f'{sd} hip','torso',None,hips,th,stiff=0.98,mass=0.3)
    add(f'{sd} thigh',f'{sd} hip',f'leg{sd}_up',th,kn,hang=(sg*math.sin(math.radians(5)),-math.cos(math.radians(5))),stiff=0.14,limit=60,mass=1,dz=(0.02 if sd=='L' else 0.0))
    miny=min(v[0][1] for mi,m in enumerate(meshes) for i,v in enumerate(m['V']) if vparts[mi][i]==f'leg{sd}_lo')
    add(f'{sd} shin',f'{sd} thigh',f'leg{sd}_lo',kn,(kn[0],miny,kn[2]),stiff=0.08,limit=80,mass=0.8,dz=(0.03 if sd=='L' else 0.01))
out='/tmp/cr/out'
print(R.export_parts(meshes,vparts,S,K,imgs,out,'popoyrag',vsets=vsets))
base=json.load(open('/tmp/claude-0/-home-claude/34603d08-b118-5cde-bf26-103b23158c8a/scratchpad/ui/site/rigs/popoy.json'))
r=R.build_rig(base,'popoydameragdoll','Popoy (Dame Tu Cosita) ragdoll','popoyrag',K,seglist)
json.dump(r,open(out+'/popoydameragdoll.json','w'),indent=1); print('segs',len(r['segments']))
