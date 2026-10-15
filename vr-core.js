/* ================================================================
   ABYSSWALKER VR — WebXR layer for Meta Quest.
   The 2D game keeps running unchanged; this module:
     • renders through a first-person rig locked to Kael (fights)
       or to blink-cut viewpoints of the director camera (cutscenes)
     • translates Quest controllers into the game's keyboard/mouse input
     • mirrors DOM menus / HUD / subtitles onto in-headset panels
   ?vrsim=1 runs the same pipeline on a desktop monitor for testing.
   ================================================================ */
(function(){
'use strict';
const UI=window.AWVRUI;
const params=new URLSearchParams(location.search);
const RIG_SCALE=.8;             // world feels 25% larger: Kael is shorter than a standing player
const FRAMEBUFFER_SCALE=.85;    // Quest 2 GPU headroom
const RESUME_KEY='aw_vr_resume';
const DIRECTOR_STATES=/^(cutscene|vesperFinale|bridge\d?)$/;
const SKIPPABLE=/^(intro|cutscene|bridge\d?)$/;

const VR={active:false,presenting:false,sim:params.has('vrsim'),isQuest:/OculusBrowser|Quest/i.test(navigator.userAgent)};
let T,ctx,renderer,rig,offset,vrCam,theater,theaterScreen,videoTex,reticle,flashSphere,fadeSphere;
let screenPanel,videoPanel,hudPanel,bannerPanel,subPanel,lorePanel;
const ctrls=[];const pads={left:null,right:null};const prevBtn={left:{},right:{}};
const held=new Set();
let headY=1.6,needRecenter=0,lastStrip=0,hoverKey='',activeHand='right';
const banner={main:'',sub:'',t:99};
const flashState={color:null,a:0,decay:1},fadeState={a:0};
const director={mode:'',lastE:null,lastYaw:0,lastSnap:-99};
const track={shots:0,hp:-1,cd:{q:0,e:0,r:0}};
let clockT=0,simNdc=null;

/* ---------------------------- install ---------------------------- */
VR.install=function(c){
  ctx=c;T=c.THREE;renderer=c.renderer;simNdc=new T.Vector2(0,.1);
  renderer.xr.enabled=true;
  renderer.xr.setReferenceSpaceType('local-floor');
  rig=new T.Group();rig.name='vr-rig';rig.scale.setScalar(RIG_SCALE);
  offset=new T.Group();rig.add(offset);
  vrCam=new T.PerspectiveCamera(72,innerWidth/innerHeight,.05,420);
  vrCam.position.set(0,1.6,0);offset.add(vrCam);
  for(let i=0;i<2;i++)buildController(i);
  buildOverlays();buildPanels();buildReticle();injectStyles();
  window.addEventListener('resize',()=>{vrCam.aspect=innerWidth/innerHeight;vrCam.updateProjectionMatrix();});
  /* the game clears its input on blur; forget our held keys so the next stick push re-sends them */
  window.addEventListener('blur',()=>held.clear());
  if(VR.sim){
    VR.active=true;activateLowSpec();
    const trackPtr=e=>{simNdc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);};
    window.addEventListener('pointermove',trackPtr);
    let lastDown=0;
    const down=e=>{trackPtr(e);if(e.button!==0||performance.now()-lastDown<80)return;lastDown=performance.now();simClick();};
    window.addEventListener('pointerdown',down);window.addEventListener('mousedown',down);
  }
};

function buildController(i){
  const ray=renderer.xr.getController(i),grip=renderer.xr.getControllerGrip(i);
  offset.add(ray);offset.add(grip);
  const line=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0,0,0),new T.Vector3(0,0,-1)]),
    new T.LineBasicMaterial({color:0x35e0ff,transparent:true,opacity:.75,depthWrite:false}));
  line.renderOrder=950;line.visible=false;ray.add(line);
  const dot=new T.Mesh(new T.SphereGeometry(.012,10,8),new T.MeshBasicMaterial({color:0xffffff,depthTest:false,transparent:true}));
  dot.renderOrder=951;dot.visible=false;offset.add(dot);
  const c={i,ray,grip,line,dot,hand:'',source:null,model:null};
  ray.addEventListener('connected',e=>{
    c.source=e.data;c.hand=e.data.handedness;
    if(c.model)grip.remove(c.model);
    c.model=c.hand==='left'?makeLeftHand():makeRightHand();grip.add(c.model);
  });
  ray.addEventListener('disconnected',()=>{c.source=null;c.hand='';if(c.model){grip.remove(c.model);c.model=null;}});
  ctrls.push(c);
}
function glowMat(color,opacity){return new T.MeshBasicMaterial({color,transparent:opacity<1,opacity,blending:opacity<1?T.AdditiveBlending:T.NormalBlending,depthWrite:opacity>=1});}
function makeRightHand(){
  /* Kael's astral cannon */
  const g=new T.Group();
  const body=new T.Mesh(new T.CylinderGeometry(.022,.03,.17,10),glowMat(0x1a1430,1));body.rotation.x=Math.PI/2;body.position.z=-.03;g.add(body);
  for(let k=0;k<3;k++){const ring=new T.Mesh(new T.TorusGeometry(.031,.004,6,24),glowMat(0x35e0ff,.85));ring.position.z=-.08+k*.045;g.add(ring);}
  const tip=new T.Mesh(new T.OctahedronGeometry(.026,0),glowMat(0x9df3ff,1));tip.position.z=-.13;g.add(tip);
  const halo=new T.Mesh(new T.SphereGeometry(.05,12,10),glowMat(0x35e0ff,.25));halo.position.z=-.13;g.add(halo);
  g.userData.tip=tip;g.userData.halo=halo;return g;
}
function makeLeftHand(){
  /* void focus that orbits the off hand */
  const g=new T.Group();
  const core=new T.Mesh(new T.DodecahedronGeometry(.03,0),glowMat(0xa44dff,1));core.position.set(0,.01,-.05);g.add(core);
  const ring=new T.Mesh(new T.TorusGeometry(.05,.003,6,32),glowMat(0xff2244,.7));ring.position.copy(core.position);g.add(ring);
  g.userData.core=core;g.userData.ring=ring;return g;
}
function buildOverlays(){
  const mk=(color)=>{const m=new T.Mesh(new T.SphereGeometry(.4,16,12),new T.MeshBasicMaterial({color,transparent:true,opacity:0,side:T.BackSide,depthTest:false,depthWrite:false,fog:false,toneMapped:false}));m.renderOrder=999;m.visible=false;offset.add(m);return m;};
  flashSphere=mk(0xffffff);fadeSphere=mk(0x000000);fadeSphere.renderOrder=1000;
}
function buildPanels(){
  screenPanel=new UI.Panel(T,1.6,1.1,1024);videoPanel=new UI.Panel(T,1.1,.42,1024);
  hudPanel=new UI.Panel(T,1.0,.25,1024);bannerPanel=new UI.Panel(T,3.2,.7,1280);
  subPanel=new UI.Panel(T,1.5,.32,1024);lorePanel=new UI.Panel(T,2.6,.7,1280);
  for(const p of [screenPanel,videoPanel,hudPanel,bannerPanel,subPanel,lorePanel]){p.visible=false;rig.add(p.mesh);}
}
function buildReticle(){
  const cv=document.createElement('canvas');cv.width=cv.height=128;const g=cv.getContext('2d');
  g.strokeStyle='#9df3ff';g.lineWidth=7;g.shadowColor='#35e0ff';g.shadowBlur=12;
  g.beginPath();g.arc(64,64,40,0,Math.PI*2);g.stroke();g.fillStyle='#fff';g.beginPath();g.arc(64,64,6,0,Math.PI*2);g.fill();
  const tex=new T.CanvasTexture(cv);
  reticle=new T.Sprite(new T.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,fog:false,toneMapped:false}));
  reticle.renderOrder=940;reticle.visible=false;
}
function buildTheater(){
  theater=new T.Scene();theater.background=new T.Color(0x010006);
  const n=1400,pos=new Float32Array(n*3);
  for(let i=0;i<n;i++){const u=Math.random()*2-1,a=Math.random()*Math.PI*2,r=40+Math.random()*30,s=Math.sqrt(1-u*u);pos[i*3]=Math.cos(a)*s*r;pos[i*3+1]=u*r;pos[i*3+2]=Math.sin(a)*s*r;}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(pos,3));
  theater.add(new T.Points(geo,new T.PointsMaterial({color:0x9fd9ff,size:.18,sizeAttenuation:true,fog:false})));
  const ring=new T.Mesh(new T.TorusGeometry(3.2,.025,8,96),glowMat(0x35e0ff,.35));ring.rotation.x=Math.PI/2;theater.add(ring);
  theaterScreen=new T.Group();
  const frameGlow=new T.Mesh(new T.PlaneGeometry(10.4,6.1),glowMat(0xa44dff,.08));frameGlow.position.z=-.02;theaterScreen.add(frameGlow);
  const screen=new T.Mesh(new T.PlaneGeometry(9.6,5.4),new T.MeshBasicMaterial({color:0x111111,toneMapped:false,fog:false}));
  theaterScreen.add(screen);theaterScreen.userData.screen=screen;
  theaterScreen.position.set(0,1.75,-6.2);theater.add(theaterScreen);
}

/* ---------------------------- session ---------------------------- */
VR.supported=async function(){
  try{return !!(navigator.xr&&await navigator.xr.isSessionSupported('immersive-vr'));}catch(e){return false;}
};
VR.enter=async function(){
  const session=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor']});
  renderer.xr.setFramebufferScaleFactor(FRAMEBUFFER_SCALE);
  await renderer.xr.setSession(session);
  if(renderer.xr.setFoveation)renderer.xr.setFoveation(1);
  VR.active=true;VR.presenting=true;needRecenter=3;director.mode='';
  activateLowSpec();hideReenter();
  try{const space=renderer.xr.getReferenceSpace();if(space&&space.addEventListener)space.addEventListener('reset',()=>{needRecenter=2;});}catch(e){}
  session.addEventListener('visibilitychange',()=>{if(session.visibilityState!=='visible'&&ctx.gameState==='fight')tapKey('Escape');});
  session.addEventListener('end',()=>{
    VR.presenting=false;VR.active=VR.sim;releaseAll();
    if(rig.parent)rig.parent.remove(rig);if(reticle.parent)reticle.parent.remove(reticle);
    if(ctx.gameState==='fight')tapKey('Escape');
    showReenter();
  });
  return session;
};
/* restarts reload the page — keep the player in the headset (Quest sessiongranted) */
function markResume(){try{sessionStorage.setItem(RESUME_KEY,'1');}catch(e){}}

/* ---------------------------- graphics budget ---------------------------- */
function activateLowSpec(){
  if(VR._lowSpec)return;VR._lowSpec=true;
  Object.assign(ctx.SETTINGS,ctx.GRAPHICS_PRESETS.Low,{preset:'Low',screenShake:0,motionEffects:0,dynamicResolution:false,depthOfField:false});
  ctx.applyGraphicsSettings();ctx.applyShadowCasters();
  /* the 5 reactive punctuation lights cost a per-pixel loop each in stereo */
  if(ctx.lightingDirector&&ctx.lightingDirector.lights)for(const l of ctx.lightingDirector.lights)l.visible=false;
  stripMaterials(ctx.scene);stripMaterials(ctx.menuScene);
}
/* drop normal/roughness maps, clearcoat, sheen and transmission in place,
   so game code that animates these materials keeps working */
function stripMaterials(root){
  root.traverse(o=>{
    if(!o.isMesh||!o.material)return;
    for(const m of Array.isArray(o.material)?o.material:[o.material]){
      if(!m||!m.isMeshStandardMaterial||m.userData.vrLite)continue;
      m.userData.vrLite=true;let dirty=false;
      for(const k of ['normalMap','roughnessMap','metalnessMap','bumpMap','displacementMap','envMap'])if(m[k]){m[k]=null;dirty=true;}
      if(m.isMeshPhysicalMaterial){if(m.clearcoat){m.clearcoat=0;dirty=true;}if(m.sheen){m.sheen=null;dirty=true;}if(m.transmission){m.transmission=0;dirty=true;}}
      if(dirty)m.needsUpdate=true;
    }
  });
}

/* ---------------------------- input ---------------------------- */
function key(code,down){
  if(down===held.has(code))return;
  if(down)held.add(code);else held.delete(code);
  window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,key:code,bubbles:true,cancelable:true}));
}
function tapKey(code){key(code,true);key(code,false);}
function releaseAll(){for(const c of Array.from(held))key(c,false);if(ctx)ctx.input.mouseDown=false;}
function stick(gp){if(!gp)return [0,0];const a=gp.axes;return a.length>=4?[a[2]||0,a[3]||0]:[a[0]||0,a[1]||0];}
function btn(gp,i){const b=gp&&gp.buttons[i];return !!(b&&(b.pressed||b.value>.6));}
function edge(hand,name,now){const p=prevBtn[hand];const was=!!p[name];p[name]=now;return now&&!was;}
function pulse(hand,v,ms){
  const gp=pads[hand],h=gp&&gp.hapticActuators&&gp.hapticActuators[0];
  if(h&&h.pulse){try{const p=h.pulse(v,ms);if(p&&p.catch)p.catch(()=>{});}catch(e){}}
}
function readPads(){
  pads.left=pads.right=null;
  const s=renderer.xr.getSession();if(!s)return;
  for(const src of s.inputSources){if(src.gamepad&&(src.handedness==='left'||src.handedness==='right'))pads[src.handedness]=src.gamepad;}
}
function handCtrl(hand){return ctrls.find(c=>c.hand===hand&&c.source);}

function updateInput(){
  readPads();
  const L=pads.left,R=pads.right,st=ctx.gameState,uiMode=!!currentModel;
  const [lx,ly]=stick(L);
  /* triggers / buttons (Quest xr-standard: 0 trigger, 1 grip, 3 stick, 4 A/X, 5 B/Y) */
  const rTrig=btn(R,0),lTrig=btn(L,0),grip=btn(L,1)||btn(R,1);
  const A=btn(R,4),B=btn(R,5),X=btn(L,4),Y=btn(L,5);
  const ePause=edge('left','y',Y),eB=edge('right','b',B),eA=edge('right','a',A);
  const eRT=edge('right','trig',rTrig),eLT=edge('left','trig',lTrig);
  if(eRT)activeHand='right';else if(eLT)activeHand='left';

  if(st==='fight'&&!uiMode){
    key('KeyA',lx<-.45||(held.has('KeyA')&&lx<-.25));
    key('KeyD',lx>.45||(held.has('KeyD')&&lx>.25));
    if(ctx.encounter===5){key('KeyW',ly<-.45);key('KeyS',ly>.45);}else{key('KeyW',false);key('KeyS',false);}
    key('Space',A);
    key('KeyE',B||grip);
    key('KeyQ',lTrig);
    key('KeyR',X);
    ctx.input.mouseDown=rTrig;
  }else{
    for(const c of ['KeyA','KeyD','KeyW','KeyS','Space','KeyE','KeyQ','KeyR'])key(c,false);
    ctx.input.mouseDown=false;
    if(st==='choosing'){
      if(edge('left','sl',lx<-.6))tapKey('ArrowLeft');
      if(edge('left','sr',lx>.6))tapKey('ArrowRight');
      if(eA)tapKey('Enter');
    }
  }
  if(ePause&&(st==='fight'||st==='paused'))tapKey('Escape');
  if(eB){
    if(st==='video'){const s=document.getElementById('intro-video-skip');if(s)s.click();}
    else if(SKIPPABLE.test(st)){window.dispatchEvent(new MouseEvent('mousedown',{button:0}));window.dispatchEvent(new MouseEvent('mouseup',{button:0}));}
  }
  if(uiMode&&(eRT||eLT))uiClick(eRT?'right':'left');
}

/* ---------------------------- aiming ---------------------------- */
let _aimO,_aimD,_ray;
function aimRay(){
  if(!_aimO){_aimO=new T.Vector3();_aimD=new T.Vector3();_ray=new T.Raycaster();}
  if(VR.sim){
    vrCam.updateMatrixWorld(true);
    _ray.setFromCamera(simNdc,vrCam);
    const target=_ray.ray.at(60,new T.Vector3());
    _aimO.set(.22,-.28,-.3).applyMatrix4(vrCam.matrixWorld);
    _aimD.copy(target).sub(_aimO).normalize();return {origin:_aimO,dir:_aimD};
  }
  const c=handCtrl('right')||handCtrl('left');if(!c)return null;
  c.ray.updateMatrixWorld(true);
  _aimO.setFromMatrixPosition(c.ray.matrixWorld);
  _aimD.set(0,0,-1).transformDirection(c.ray.matrixWorld);
  return {origin:_aimO,dir:_aimD};
}
VR.muzzle=function(out){
  if(!VR.active||modeFor(ctx.gameState)!=='fp')return false;
  const a=aimRay();if(!a)return false;out.copy(a.origin).addScaledVector(a.dir,.12*RIG_SCALE);return true;
};
VR.aimPoint=function(plane){
  if(!VR.active||modeFor(ctx.gameState)!=='fp')return null;
  const a=aimRay();if(!a)return null;
  const pt=new T.Vector3(),ray=new T.Ray(a.origin,a.dir);
  if(ray.intersectPlane(plane,pt)&&pt.distanceTo(a.origin)<220)return pt;
  return a.origin.clone().addScaledVector(a.dir,90);
};

/* ---------------------------- UI pointer ---------------------------- */
let currentModel=null,currentPanel=null;
function pointerRaycaster(c){
  const rc=new T.Raycaster();
  if(VR.sim){vrCam.updateMatrixWorld(true);rc.setFromCamera(simNdc,vrCam);return rc;}
  c.ray.updateMatrixWorld(true);
  const o=new T.Vector3().setFromMatrixPosition(c.ray.matrixWorld),d=new T.Vector3(0,0,-1).transformDirection(c.ray.matrixWorld);
  rc.set(o,d);return rc;
}
function updatePointers(){
  let hover='';
  const sources=VR.sim?[{hand:'right',sim:true}]:ctrls.filter(c=>c.source);
  for(const c of ctrls){c.line.visible=false;c.dot.visible=false;}
  if(!currentPanel)return setHover('');
  for(const c of sources){
    const hit=currentPanel.hitTest(pointerRaycaster(c));
    if(!c.sim){
      c.line.visible=true;c.line.scale.z=hit?hit.distance/RIG_SCALE:2.2;
      c.line.material.opacity=c.hand===activeHand?.85:.35;
      if(hit){c.dot.visible=true;c.dot.position.copy(offset.worldToLocal(hit.point.clone()));}
    }
    if(hit&&hit.button&&(c.hand===activeHand||!hover))hover=hit.button.id;
  }
  setHover(hover);
}
function setHover(id){
  if(id!==hoverKey){hoverKey=id;if(id)pulse(activeHand,.12,12);}
  for(const p of [screenPanel,videoPanel])p.hover=id||null;
}
function uiClick(hand){
  if(!currentPanel)return;
  const c=VR.sim?{hand,sim:true}:handCtrl(hand);if(!c)return;
  const hit=currentPanel.hitTest(pointerRaycaster(c));
  if(!hit||!hit.button)return;
  const b=hit.button;pulse(hand,.35,30);
  if(b.reload)markResume();
  if(b.el)b.el.click();
  currentPanel.signature='';
}
function simClick(){if(VR.sim&&currentPanel)uiClick("right");}

/* ---------------------------- rig placement ---------------------------- */
function modeFor(st){
  if(st==='menu'||st==='boot')return 'menu';
  if(st==='video')return 'theater';
  if(st==='intro')return 'void';
  if(DIRECTOR_STATES.test(st))return 'director';
  return 'fp';
}
function placeRig(mode,dirCam){
  let target;
  if(mode==='fp'){
    target=ctx.scene;rig.position.set(ctx.player.x,ctx.player.y,ctx.HERO_Z);rig.rotation.set(0,0,0);
  }else if(mode==='director'){
    target=ctx.scene;directorSnap(dirCam||ctx.camera);
  }else if(mode==='menu'){
    target=ctx.menuScene;rig.position.set(0,-.1,9.5);rig.rotation.set(0,0,0);
  }else{
    if(!theater)buildTheater();target=theater;rig.position.set(0,0,0);rig.rotation.set(0,0,0);
  }
  if(mode!=='director')director.mode=mode;
  if(rig.parent!==target)target.add(rig);
  if(mode==='fp'){if(reticle.parent!==ctx.scene)ctx.scene.add(reticle);}
  rig.updateMatrixWorld(true);
}
function directorSnap(cam){
  const E=cam.position,d=new T.Vector3();cam.getWorldDirection(d);
  const yaw=Math.atan2(-d.x,-d.z);
  const first=director.mode!=='director'||!director.lastE;
  const moved=first||E.distanceTo(director.lastE)>3.5||Math.abs(Math.atan2(Math.sin(yaw-director.lastYaw),Math.cos(yaw-director.lastYaw)))>.9;
  if(!(first||(moved&&clockT-director.lastSnap>1.4)))return;
  director.mode='director';director.lastE=E.clone();director.lastYaw=yaw;director.lastSnap=clockT;
  rig.rotation.set(0,yaw,0);
  const head=new T.Vector3(vrCam.position.x+offset.position.x,headY,vrCam.position.z+offset.position.z).multiplyScalar(RIG_SCALE);
  head.applyAxisAngle(new T.Vector3(0,1,0),yaw);
  rig.position.set(E.x-head.x,E.y-head.y,E.z-head.z);
  if(!first||VR.presenting)fadeState.a=1;
}
function recenter(){
  offset.position.set(-vrCam.position.x,0,-vrCam.position.z);
}

/* ---------------------------- per-frame hooks ---------------------------- */
VR.preUpdate=function(dt){
  document.body.classList.toggle('vr-on',VR.active);
  if(!VR.active)return;
  clockT+=dt;
  if(VR.presenting){
    if(needRecenter>0&&--needRecenter===0)recenter();
    headY+=(vrCam.position.y-headY)*Math.min(1,dt*2);
  }
  currentModel=UI.activeScreen(ctx.gameState);
  placeRig(modeFor(ctx.gameState));
  if(VR.presenting)updateInput();
  updateHaptics();
  if(clockT-lastStrip>1.5){lastStrip=clockT;stripMaterials(ctx.scene);}
};
function updateHaptics(){
  const rs=ctx.runStats,p=ctx.player;
  if(rs.shotsFired>track.shots)pulse('right',.18,14);
  track.shots=rs.shotsFired;
  if(track.hp>=0&&p.hp<track.hp-.5){pulse('left',.9,140);pulse('right',.9,140);}
  track.hp=p.hp;
  for(const k of ['q','e','r']){const cd=ctx.abilities[k].cd;if(cd>track.cd[k]+1)pulse(k==='q'?'left':(k==='r'?'left':'right'),.6,80);track.cd[k]=cd;}
}
function updateOverlays(mode,dt){
  const st=ctx.gameState;
  /* head-relative anchors (rig-local metres) */
  const hy=headY;
  const model=currentModel;
  currentPanel=null;
  screenPanel.visible=videoPanel.visible=false;
  if(model){
    const panel=model.kind==='intro-video-screen'?videoPanel:screenPanel;
    UI.drawScreen(panel,model);panel.visible=true;currentPanel=panel;
    if(panel===videoPanel)panel.mesh.position.set(0,hy-.62,-1.25);
    else panel.mesh.position.set(0,hy-.18,-1.65);
    panel.mesh.rotation.set(panel===videoPanel?-.35:0,0,0);
  }
  /* combat HUD */
  const hudOn=mode==='fp'&&!model&&UI.shown('hud')&&(st==='fight'||st==='dying');
  hudPanel.visible=hudOn;
  if(hudOn){UI.drawHUD(hudPanel,hudState());hudPanel.mesh.position.set(0,hy-.66,-.95);hudPanel.mesh.rotation.set(-.62,0,0);}
  /* announce banner */
  banner.t+=dt;
  const ba=banner.t<.25?banner.t/.25:(banner.t<3?1:Math.max(0,1-(banner.t-3)/.6));
  bannerPanel.visible=ba>.01&&(mode==='fp'||mode==='director')&&!model;
  if(bannerPanel.visible){UI.drawBanner(bannerPanel,banner.main,banner.sub);bannerPanel.opacity=ba;bannerPanel.mesh.position.set(0,hy+.55,-3.2);}
  /* subtitles */
  const sub=readSubtitle(),hint=VR.presenting&&SKIPPABLE.test(st)&&st!=='intro'?'B  ·  SKIP':'';
  subPanel.visible=(mode==='fp'||mode==='director')&&!model&&!!(sub.line||hint);
  if(subPanel.visible){UI.drawSubtitle(subPanel,sub.who,sub.line,hint);subPanel.mesh.position.set(0,hy-.4,-1.45);subPanel.mesh.rotation.set(-.18,0,0);}
  /* dream-intro lore lines */
  lorePanel.visible=false;
  if(mode==='void'){
    const lore=readLore();lorePanel.visible=lore.a>.01;
    UI.drawLore(lorePanel,lore.line,lore.final);lorePanel.opacity=lore.a;lorePanel.mesh.position.set(0,hy,-2.6);
  }
  /* theater */
  if(theater){
    theaterScreen.visible=mode==='theater';
    if(mode==='theater'&&!videoTex){
      const v=document.getElementById('intro-video');
      if(v){videoTex=new T.VideoTexture(v);videoTex.encoding=T.sRGBEncoding;const m=theaterScreen.userData.screen.material;m.map=videoTex;m.color.set(0xffffff);m.needsUpdate=true;}
    }
  }
  /* aim reticle + right-hand glow */
  const aiming=mode==='fp'&&st==='fight'&&!model;
  reticle.visible=false;
  if(aiming){
    const pt=VR.aimPoint(ctx.aimPlane);
    if(pt){const a=aimRay();reticle.position.copy(pt);reticle.scale.setScalar(Math.max(.4,pt.distanceTo(a.origin)*.035));reticle.visible=true;}
    const c=handCtrl('right');
    if(c){c.line.visible=true;c.line.scale.z=3.5;c.line.material.opacity=.22;}
  }
  const rc=handCtrl('right'),lc=handCtrl('left');
  if(rc&&rc.model&&rc.model.userData.halo){const e=ctx.player.energy/ctx.CFG.energyMax;rc.model.userData.halo.material.opacity=.08+.32*e;rc.model.userData.tip.rotation.z+=dt*3;}
  if(lc&&lc.model&&lc.model.userData.core){lc.model.userData.core.rotation.y+=dt*1.6;lc.model.userData.ring.rotation.x+=dt*.9;}
  /* flash + blink fade around the head */
  flashState.a=Math.max(0,flashState.a-dt*flashState.decay);
  flashSphere.visible=flashState.a>.01;
  if(flashSphere.visible){flashSphere.material.opacity=flashState.a;flashSphere.position.copy(vrCam.position);}
  fadeState.a=Math.max(0,fadeState.a-dt*4);
  fadeSphere.visible=fadeState.a>.01;
  if(fadeSphere.visible){fadeSphere.material.opacity=Math.min(1,fadeState.a);fadeSphere.position.copy(vrCam.position);}
}
function readSubtitle(){
  const $=id=>document.getElementById(id);
  const sp=$('speech');
  if(sp&&sp.classList.contains('show'))return {who:sp.querySelector('.who').textContent.trim(),line:sp.querySelector('.txt').textContent.trim()};
  if(UI.shown('interlude'))return {who:'',line:($('interlude-text').textContent||'').trim()};
  if(UI.shown('story-caption'))return {who:'',line:($('story-caption').textContent||'').trim()};
  return {who:'',line:''};
}
function readLore(){
  let best={line:'',a:0,final:false};
  for(const el of document.querySelectorAll('.lore-line')){const a=parseFloat(el.style.opacity)||0;if(a>best.a)best={line:el.textContent.trim(),a,final:el.classList.contains('final')};}
  return best;
}
function hudState(){
  const enc=ctx.encounter,b=ctx.activeBossState(),max=ctx.CFG[enc===1?'bossMaxHP':'boss'+enc+'MaxHP']||1,p=ctx.player,ab=ctx.abilities;
  const txt=id=>{const e=document.getElementById(id);return e?(e.textContent||'').trim():'';};
  return {bossName:txt('boss-name'),bossPhase:txt('boss-phase'),bossFrac:b?b.hp/max:0,hpFrac:p.hp/ctx.CFG.playerMaxHP,energyFrac:p.energy/ctx.CFG.energyMax,
    revives:p.revives,invuln:p.invuln>0,
    cds:[{cd:ab.q.cd,max:ab.q.max,glyph:'✦',button:'L TRIGGER',name:'OVERCHARGE'},
         {cd:ab.e.cd,max:ab.e.max,glyph:'❋',button:'B / GRIP',name:'ASTRAL SHIFT'},
         {cd:ab.r.cd,max:ab.r.max,glyph:'⚡',button:'X',name:'JUDGMENT'}]};
}

/* ---------------------------- render hooks ---------------------------- */
let lastRenderT=performance.now();
function vrRender(dirCam){
  const now=performance.now(),dt=Math.min(.1,(now-lastRenderT)/1000);lastRenderT=now;
  const mode=modeFor(ctx.gameState);
  placeRig(mode,dirCam);
  updatePointers();
  updateOverlays(mode,dt);
  let heroWas=null;
  if(mode==='fp'){heroWas=ctx.hero.visible;ctx.hero.visible=false;}
  renderer.render(rig.parent,vrCam);
  if(heroWas!==null)ctx.hero.visible=heroWas;
  return true;
}
VR.renderWorld=function(scene,camera){return VR.active?vrRender(camera):false;};
VR.renderMenu=function(){return VR.active?vrRender(null):false;};
VR.renderVoid=function(){if(VR.active)vrRender(null);};
VR.isPresenting=()=>VR.presenting;
VR.debugPanels=()=>({screen:screenPanel.canvas,video:videoPanel.canvas,hud:hudPanel.canvas,banner:bannerPanel.canvas,sub:subPanel.canvas,lore:lorePanel.canvas});

/* ---------------------------- game event hooks ---------------------------- */
VR.announce=function(main,sub){banner.main=main||'';banner.sub=sub||'';banner.t=0;};
VR.flash=function(color,opacity,dur){
  if(!VR.active)return;
  const m=String(color).match(/rgba?\(([^)]+)\)/);if(!m)return;
  const [r,g,b]=m[1].split(',').map(Number);
  flashSphere.material.color.setRGB(r/255,g/255,b/255);
  flashState.a=Math.min(.6,(Number(opacity)||0)*.65);flashState.decay=flashState.a/Math.max(.08,Number(dur)||.4);
};

/* ---------------------------- landing / boot ---------------------------- */
function injectStyles(){
  const s=document.createElement('style');
  s.textContent=`#vr-landing{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
  background:radial-gradient(ellipse at 50% 110%,#2a0b45 0%,#07020f 55%,#010006 100%);font-family:Georgia,serif;color:#cfd6ff;text-align:center;padding:16px}
  #vr-landing h1{font-size:clamp(34px,8vw,84px);letter-spacing:.3em;color:#eaf6ff;text-shadow:0 0 30px rgba(53,224,255,.8);margin:0}
  #vr-landing p{letter-spacing:.25em;font-size:13px;color:#7d86bd;margin:0;max-width:640px;line-height:1.8}
  #vr-landing button,#vr-reenter{font:700 20px Georgia,serif;letter-spacing:.3em;padding:18px 54px;border-radius:8px;cursor:pointer;
  color:#fff;background:linear-gradient(#2a1660,#0c0620);border:2px solid #35e0ff;box-shadow:0 0 28px rgba(53,224,255,.45)}
  #vr-landing button.secondary{font-size:13px;padding:12px 30px;border-color:#a44dff;box-shadow:none;color:#c9b2ff}
  #vr-landing button:disabled{opacity:.35;cursor:not-allowed}
  #vr-landing .controls{font-size:12px;letter-spacing:.12em;color:#8b93c4;line-height:2;border:1px solid rgba(120,90,200,.35);padding:14px 22px;border-radius:6px;background:rgba(8,4,18,.55)}
  #vr-landing .controls b{color:#ffcf6e}
  body.vr-on>*:not(#game-holder):not(#vr-landing):not(#vr-reenter){visibility:hidden!important}
  #vr-reenter{position:fixed;top:16px;right:16px;z-index:190;display:none;font-size:14px;padding:12px 26px}`;
  document.head.appendChild(s);
}
function showReenter(){const b=document.getElementById('vr-reenter');if(b)b.style.display='block';}
function hideReenter(){const b=document.getElementById('vr-reenter');if(b)b.style.display='none';}

VR.boot=function(playVideo,skipVideo){
  let resume=false;try{resume=sessionStorage.getItem(RESUME_KEY)==='1';sessionStorage.removeItem(RESUME_KEY);}catch(e){}
  const el=document.createElement('div');el.id='vr-landing';
  el.innerHTML=`<h1>ABYSSWALKER</h1><p>VR EDITION // META QUEST</p>
    <button id="vr-enter" type="button" disabled>CHECKING VR…</button>
    <div class="controls"><b>LEFT STICK</b> strafe &nbsp;·&nbsp; <b>RIGHT TRIGGER</b> fire (aim with right hand) &nbsp;·&nbsp; <b>A</b> jump<br>
    <b>B / GRIP</b> astral shift &nbsp;·&nbsp; <b>LEFT TRIGGER</b> overcharge &nbsp;·&nbsp; <b>X</b> judgment &nbsp;·&nbsp; <b>Y</b> pause<br>
    Point &amp; pull a trigger on menus &nbsp;·&nbsp; <b>B</b> skips cutscenes &nbsp;·&nbsp; boss 5: left stick up/down to fly</div>
    <button id="vr-flat" class="secondary" type="button">${VR.sim?'PLAY VR SIMULATION':'PLAY ON THIS SCREEN'}</button>
    <p id="vr-status"></p>`;
  document.body.appendChild(el);
  const re=document.createElement('button');re.id='vr-reenter';re.type='button';re.textContent='ENTER VR';document.body.appendChild(re);
  const enterBtn=el.querySelector('#vr-enter'),status=el.querySelector('#vr-status');
  let started=false;
  const start=vr=>{
    if(started)return;started=true;el.remove();
    if(resume){skipVideo();return;}
    playVideo();
    if(vr){const snd=document.getElementById('intro-video-sound');if(snd)snd.click();}
  };
  const go=()=>VR.enter().then(()=>start(true)).catch(err=>{status.textContent='COULD NOT START VR: '+(err&&err.message||err);});
  enterBtn.addEventListener('click',go);
  re.addEventListener('click',()=>VR.enter().catch(()=>{}));
  el.querySelector('#vr-flat').addEventListener('click',()=>start(false));
  /* isSessionSupported() can report false inside installed Quest web apps even though
     requestSession() works, so only a missing navigator.xr disables the button */
  const hasXR=!!(navigator.xr&&navigator.xr.requestSession);
  VR.supported().then(ok=>{
    enterBtn.disabled=!(ok||hasXR);enterBtn.textContent=(ok||hasXR)?'ENTER VR':'VR NOT AVAILABLE';
    if(!hasXR)status.textContent=window.isSecureContext?'WEBXR IS NOT AVAILABLE IN THIS BROWSER':'WEBXR NEEDS HTTPS (OR LOCALHOST)';
    else if(resume)status.textContent='RETURNING TO THE ABYSS…';
    else if(!ok)status.textContent='HEADSET CHECK WAS UNCERTAIN — PRESS ENTER VR TO TRY';
  });
  if(navigator.xr&&navigator.xr.addEventListener)navigator.xr.addEventListener('sessiongranted',()=>{if(!VR.presenting)go();});
};

window.AWVR=VR;
})();
