import sys,json
sys.path.insert(0,'/tmp/cr/rag')
import numpy as np
import zombie as Z, skinrig as SR, zskin, animals as A, ragdoll3 as R3

def free(segs):
    for sd in segs:
        if sd['name'] in ('body','head','neck') or sd.get('stiff',0)>=0.9: continue
        sd['stiff']=min(sd.get('stiff',0.05),0.06); sd['limit']=max(sd.get('limit',90),90)

def build(dumpdir,rid,name,prefix,outdir,base,kind):
    bones,meshes=Z.load_dump(dumpdir)
    segs,B=(A.bird_spec if kind=='bird' else A.rabbit_spec)(bones,meshes,[['body' for _ in m['V']] for m in meshes])
    vp=Z.vparts(meshes,bones,B)
    segs,B=(A.bird_spec if kind=='bird' else A.rabbit_spec)(bones,meshes,vp)
    allv=np.array([v[0] for m in meshes for v in m['V']]); ext=allv.max(0)-allv.min(0); K=1.7/max(ext)
    imgs=Z.images(meshes)
    p2s={s['part']:s['name'] for s in segs if s.get('part')}
    free(segs)
    ms=zskin.skin_meshes(meshes,bones,B,p2s,vp)
    return SR.build(base,rid,name,prefix,K,segs,ms,imgs,outdir)

def build_rabbit_mouth(dumpdir,rid,name,prefix,outdir,base):
    bones,meshes=Z.load_dump(dumpdir)
    H=lambda n:bones[n]['head']; T=lambda n:bones[n]['tail']
    B={'GGG':'body','bassin':'body','cou':'head','tet':'head'}
    for s in 'gd': B.update({'bras.'+s:'ar_'+s,'main.'+s:'pw_'+s,'cuiss.'+s:'th_'+s,'pied.'+s:'ft_'+s})
    vp=Z.vparts(meshes,bones,B)
    C=H('bassin'); rear=T('bassin')
    hv=[v[0] for mi,m in enumerate(meshes) for i,v in enumerate(m['V']) if vp[mi][i]=='head']
    tip=max(hv,key=lambda p:p[2]); fr=[p for p in hv if p[2]>tip[2]-0.03*(tip[2]-min(q[2] for q in hv))]; mouth=np.array([0,min(p[1] for p in fr)*0.6+tip[1]*0.4,tip[2]-0.01])   # the mouth is on the lower part of the muzzle front, a touch inside it
    segs=[]; add=lambda n,p,s,e,part=None,**kw:segs.append(dict(name=n,parent=p,part=part,start=tuple(s),end=tuple(e),**kw))
    add('head',None,mouth,C,'head',stiff=0,mass=1)
    add('body','head',C,rear,'body',stiff=0.3,limit=70,mass=1.6)
    for s in 'gd':
        add(f'{s} shoulder','head',C,H('bras.'+s),stiff=0.98,mass=0.3)
        add(f'{s} arm',f'{s} shoulder',H('bras.'+s),T('bras.'+s),'ar_'+s,stiff=0.05,limit=100,mass=0.4)
        add(f'{s} paw',f'{s} arm',H('main.'+s),T('main.'+s),'pw_'+s,stiff=0.03,limit=100,mass=0.3)
        add(f'{s} hip','body',rear,H('cuiss.'+s),stiff=0.98,mass=0.3)
        add(f'{s} thigh',f'{s} hip',H('cuiss.'+s),T('cuiss.'+s),'th_'+s,stiff=0.05,limit=90,mass=0.6)
        add(f'{s} foot',f'{s} thigh',H('pied.'+s),T('pied.'+s),'ft_'+s,stiff=0.03,limit=100,mass=0.4)
    allv=np.array([v[0] for m in meshes for v in m['V']]); ext=allv.max(0)-allv.min(0); K=1.7/max(ext)
    imgs=Z.images(meshes); p2s={s['part']:s['name'] for s in segs if s.get('part')}
    ms=zskin.skin_meshes(meshes,bones,B,p2s,vp)
    a=np.array(segs[0]['end'])-np.array(segs[0]['start'])
    rot=R3.qinv(R3.qfrom(a))
    # spin about the string (vertical) so the rabbit's BACK faces the viewer
    b=R3.qmat(rot)@np.array([0,1.0,0]); th=np.arctan2(-b[0],b[2]) if False else np.arctan2(b[0],b[2])   # angle of the back's horizontal direction from +Z
    qy=np.array([0,np.sin(-th/2),0,np.cos(-th/2)]); rot=R3.qmul(qy,rot)
    print('back now points',R3.qmat(rot)@np.array([0,1.0,0]))
    return SR.build(base,rid,name,prefix,K,segs,ms,imgs,outdir,rot=rot)
if __name__=='__main__':
    base=json.load(open('/tmp/claude-0/-home-claude/34603d08-b118-5cde-bf26-103b23158c8a/scratchpad/ui/site/rigs/popoy.json'))
    o='/tmp/cr/rag/o2'
    build('d_crow','bs_crow_ragdoll','Crow (ragdoll)','bsrag_crow',o,base,'bird')
    build('d_duck','bs_duck_ragdoll','Duck (ragdoll)','bsrag_duck',o,base,'bird')
    build('d_rabbit','bs_rabbit_ragdoll','Rabbit (ragdoll)','bsrag_rabbit',o,base,'rabbit')
    build_rabbit_mouth('d_rabbit','bs_rabbit_mouth_ragdoll','Rabbit (ragdoll, hung by mouth)','bsrag_rabbitmouth',o,base)
    print('ok')
