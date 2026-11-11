import sys,io,contextlib,json,math; sys.path.insert(0,'/tmp/cr'); sys.path.insert(0,'/tmp/cr/rag')
import numpy as np
from PIL import Image
with contextlib.redirect_stdout(io.StringIO()): from xps import parse
import skinrig as SR
D='/mnt/user-data/uploads/Popoy (Dame Tu Cosita)/'
bones,meshes,_,_=parse(D+'xps.xps')
imgs={n:Image.open(D+n).convert('RGB') for n in ('popoy.png','WortEye.png')}
for n,i in list(imgs.items()):
    if max(i.size)>1024: imgs[n]=i.resize((1024,int(i.size[1]*1024/i.size[0])) if i.size[0]>=i.size[1] else (int(i.size[0]*1024/i.size[1]),1024))
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
def pof(bi):
    while bi>=0:
        if bi in b2p: return b2p[bi]
        bi=bones[bi][1]
    return None
p2s={'head':'head','torso':'torso','armL_up':'L upper arm','armL_lo':'L forearm','armR_up':'R upper arm','armR_lo':'R forearm','legL_up':'L thigh','legL_lo':'L shin','legR_up':'R thigh','legR_lo':'R shin'}
allv=np.array([v[0] for m in meshes for v in m['V']]); ytop=allv[:,1].max(); K=1.7/ytop
xn=P(39)[0]
neck=np.array([xn,P(39)[1],P(39)[2]]); hips=np.array([xn,P(3)[1],P(3)[2]]); top=np.array([xn,ytop,P(39)[2]])
C=np.array([xn,(P(8)[1]+P(24)[1])/2,(P(8)[2]+P(24)[2])/2]); C[1]=min(C[1],neck[1]-0.03)
def tip(part,start,d):
    best=0
    for m in meshes:
        for v in m['V']:
            if pof(int(v[4][int(np.argmax(v[5]))]))==part: best=max(best,float(np.dot(np.array(v[0])-start,d)))
    return best
# lowest vertex of each shin
def miny(part):
    return min(v[0][1] for m in meshes for v in m['V'] if pof(int(v[4][int(np.argmax(v[5]))]))==part)
segs=[]; add=lambda n,p,s,e,**kw:segs.append(dict(name=n,parent=p,start=tuple(s),end=tuple(e),**kw))
add('head',None,top,neck,stiff=0,mass=1)
add('chest','head',neck,C,stiff=0.6,limit=50,mass=0.4)
add('torso','chest',C,hips,stiff=0.9,limit=25,mass=1.2)
for sd in 'LR':
    sh=P(8 if sd=='L' else 24); el=P(9 if sd=='L' else 25)
    add(f'{sd} shoulder','chest',C,sh,stiff=0.98,mass=0.3)
    add(f'{sd} upper arm',f'{sd} shoulder',sh,el,stiff=0.02,limit=120,mass=0.6)
    d=(el-sh); d=d/np.linalg.norm(d)
    add(f'{sd} forearm',f'{sd} upper arm',el,el+d*tip(f'arm{sd}_lo',el,d),stiff=0.01,limit=110,mass=0.5)
    th=P(47 if sd=='L' else 43); kn=P(48 if sd=='L' else 44)
    add(f'{sd} hip','torso',hips,th,stiff=0.98,mass=0.3)
    add(f'{sd} thigh',f'{sd} hip',th,kn,stiff=0.03,limit=80,mass=1)
    add(f'{sd} shin',f'{sd} thigh',kn,(kn[0],miny(f'leg{sd}_lo'),kn[2]),stiff=0.01,limit=100,mass=0.8)
ms=[]
for m in meshes:
    wd=[]
    for v in m['V']:
        d={}
        for b,w in zip(v[4],v[5]):
            p=pof(int(b)); s=p2s.get(p) if p else None
            if s and w>0: d[s]=d.get(s,0)+float(w)
        if not d: d={'torso':1.0}
        wd.append(d)
    ms.append(dict(P=[v[0] for v in m['V']],N=[v[1] for v in m['V']],UV=[v[3][0] for v in m['V']],F=m['F'],tex=m['tex'][0],wd=wd))
base=json.load(open('/tmp/claude-0/-home-claude/34603d08-b118-5cde-bf26-103b23158c8a/scratchpad/ui/site/rigs/popoy.json'))
r=SR.build(base,'popoydameragdoll','Popoy (Dame Tu Cosita) ragdoll','popoyrag',K,segs,ms,imgs,'/tmp/cr/rag/o2')
print('segs',len(r['segments']))
