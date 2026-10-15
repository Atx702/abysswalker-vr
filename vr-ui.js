/* ================================================================
   ABYSSWALKER VR — canvas panels rendered inside the headset.
   Panels are textured planes; hit regions are stored in canvas px
   so controller rays can hover / click them.
   ================================================================ */
(function(){
'use strict';
const FONT='Georgia,"Palatino Linotype","Times New Roman",serif';
const C={crimson:'#ff2244',cyan:'#35e0ff',violet:'#a44dff',gold:'#ffcf6e',ink:'rgba(8,4,18,.86)',line:'rgba(120,90,200,.55)',text:'#cfd6ff',dim:'#7d86bd'};

class Panel{
  /* width/height in metres (rig-local), px = canvas width */
  constructor(THREE,width,height,px,opts){
    opts=opts||{};
    this.THREE=THREE;this.width=width;this.height=height;
    this.canvas=document.createElement('canvas');
    this.canvas.width=px;this.canvas.height=Math.round(px*height/width);
    this.ctx=this.canvas.getContext('2d');
    this.texture=new THREE.CanvasTexture(this.canvas);
    this.texture.encoding=THREE.sRGBEncoding;
    this.texture.anisotropy=4;
    this.material=new THREE.MeshBasicMaterial({map:this.texture,transparent:true,depthTest:!!opts.depthTest,depthWrite:false,toneMapped:false,fog:false});
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),this.material);
    this.mesh.renderOrder=opts.renderOrder||900;
    this.mesh.userData.vrPanel=this;
    this.buttons=[];this.hover=null;this.signature='';
  }
  get W(){return this.canvas.width;}
  get H(){return this.canvas.height;}
  set visible(v){this.mesh.visible=!!v;}
  get visible(){return this.mesh.visible;}
  set opacity(v){this.material.opacity=v;}
  /* redraw only when the signature changes */
  update(signature,drawFn){
    if(signature===this.signature)return false;
    this.signature=signature;this.buttons=[];
    const ctx=this.ctx;ctx.clearRect(0,0,this.W,this.H);
    drawFn(ctx,this.W,this.H,this);
    this.texture.needsUpdate=true;return true;
  }
  addButton(b){this.buttons.push(b);return b;}
  /* raycaster -> {button} | {panel} | null */
  hitTest(raycaster){
    if(!this.mesh.visible)return null;
    const hit=raycaster.intersectObject(this.mesh,false)[0];
    if(!hit||!hit.uv)return null;
    const x=hit.uv.x*this.W,y=(1-hit.uv.y)*this.H;
    for(const b of this.buttons){if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h&&!b.disabled)return {panel:this,button:b,distance:hit.distance,point:hit.point};}
    return {panel:this,button:null,distance:hit.distance,point:hit.point};
  }
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
function text(ctx,str,x,y,o){
  o=o||{};
  ctx.font=(o.weight||'')+' '+(o.size||28)+'px '+(o.font||FONT);
  ctx.textAlign=o.align||'center';ctx.textBaseline=o.baseline||'middle';
  if(o.glow){ctx.shadowColor=o.glow;ctx.shadowBlur=o.blur||18;}
  ctx.fillStyle=o.color||C.text;ctx.fillText(String(str),x,y,o.maxWidth||undefined);
  ctx.shadowBlur=0;
}
function wrap(ctx,str,maxW,size,weight){
  ctx.font=(weight||'')+' '+size+'px '+FONT;
  const words=String(str||'').split(/\s+/),lines=[];let line='';
  for(const w of words){const t=line?line+' '+w:w;if(ctx.measureText(t).width>maxW&&line){lines.push(line);line=w;}else line=t;}
  if(line)lines.push(line);return lines;
}
function frame(ctx,x,y,w,h,o){
  o=o||{};roundRect(ctx,x,y,w,h,o.r||18);
  ctx.fillStyle=o.fill||C.ink;ctx.fill();
  ctx.lineWidth=o.lw||3;ctx.strokeStyle=o.stroke||C.line;ctx.stroke();
}
function bar(ctx,x,y,w,h,frac,color,back){
  roundRect(ctx,x,y,w,h,h/2);ctx.fillStyle=back||'rgba(255,255,255,.08)';ctx.fill();
  const f=Math.max(0,Math.min(1,frac));
  if(f>0){roundRect(ctx,x,y,Math.max(h,w*f),h,h/2);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=14;ctx.fill();ctx.shadowBlur=0;}
}
function button(panel,ctx,b){
  const hot=panel.hover===b.id,active=!!b.active;
  roundRect(ctx,b.x,b.y,b.w,b.h,14);
  const g=ctx.createLinearGradient(b.x,b.y,b.x,b.y+b.h);
  g.addColorStop(0,hot?'rgba(53,224,255,.38)':(active?'rgba(164,77,255,.36)':'rgba(30,18,60,.85)'));
  g.addColorStop(1,hot?'rgba(20,90,130,.55)':'rgba(10,6,24,.9)');
  ctx.fillStyle=g;ctx.fill();
  ctx.lineWidth=hot?5:3;ctx.strokeStyle=hot?C.cyan:(active?C.violet:C.line);
  if(hot){ctx.shadowColor=C.cyan;ctx.shadowBlur=22;}ctx.stroke();ctx.shadowBlur=0;
  if(b.sub){
    text(ctx,b.label,b.x+b.w/2,b.y+b.h*.38,{size:b.size||34,color:'#fff',weight:'bold'});
    text(ctx,b.sub,b.x+b.w/2,b.y+b.h*.72,{size:20,color:hot?'#bff6ff':C.dim});
  }else text(ctx,b.label,b.x+b.w/2,b.y+b.h/2,{size:b.size||34,color:'#fff',weight:'bold',glow:hot?C.cyan:null});
  panel.addButton(b);
}

/* ---------- DOM screen readers (mirror the 2D game's menus) ---------- */
const $=id=>document.getElementById(id);
/* textContent, not innerText: the DOM overlays are visibility:hidden while in VR */
const txt=el=>el?(el.textContent||'').replace(/\s+/g,' ').trim():'';
const brLines=el=>el?el.innerHTML.split(/<br\s*\/?>/i).map(h=>h.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()).filter(Boolean):[];
const lead=el=>((el&&el.childNodes[0]&&el.childNodes[0].textContent)||'').trim();
const labelled=el=>el?Array.from(el.children).map(c=>lead(c)+' '+txt(c.querySelector('b'))).join('    '):'';
const firstLine=s=>String(s||'').split('\n')[0].trim();
const shown=id=>{const e=$(id);return !!(e&&e.classList.contains('show'));};

function readMenu(){
  const btns=[];
  for(const el of document.querySelectorAll('.mode-choice')){
    btns.push({id:'mode-'+el.dataset.mode,label:lead(el),sub:txt(el.querySelector('span')),el,active:el.classList.contains('active'),half:true});
  }
  btns.push({id:'start',label:'START',el:$('start-btn'),size:44});
  const scores=Array.from(document.querySelectorAll('#menu-score-list li')).slice(0,3).map(li=>Array.from(li.children).map(txt).join(' ')||txt(li));
  return {kind:'menu',title:txt($('game-title'))||'ABYSSWALKER',lines:[txt($('tagline')),txt($('mode-copy'))],buttons:btns,footer:scores.length?'RECORDS  '+scores.join('   |   '):''};
}
function readScreen(id){
  const root=$(id);if(!root)return null;
  if(id==='gameover')return {kind:id,title:'YOU DIED',lines:[txt(root.querySelector('p')),'SCORE  '+txt($('gameover-run-score')),txt($('gameover-run-meta'))],buttons:[{id:'restart',label:'RESTART',el:$('restart-btn'),reload:true}]};
  if(id==='victory')return {kind:id,title:txt($('victory-title'))||'VICTORY',lines:[txt($('victory-copy')),'SCORE  '+txt($('victory-run-score')),txt($('victory-run-meta'))],buttons:[{id:'continue',label:'CONTINUE',el:$('continue-btn')}]};
  if(id==='thanks')return {kind:id,title:'THANK YOU FOR PLAYING',lines:brLines(root.querySelector('.credits')),buttons:[{id:'again',label:'PLAY AGAIN',el:$('again-btn'),reload:true}]};
  if(id==='pause')return {kind:id,title:'PAUSED',lines:[txt($('pause-kicker')),labelled($('pause-meta'))],buttons:[{id:'resume',label:'RESUME',el:$('pause-resume')},{id:'quit',label:'QUIT TO MENU',el:$('pause-quit'),reload:true}]};
  if(id==='intro-video-screen')return {kind:id,title:txt($('intro-video-label')),lines:[txt($('intro-video-status'))],buttons:[{id:'vsound',label:txt($('intro-video-sound'))||'SOUND',el:$('intro-video-sound'),half:true},{id:'vskip',label:'SKIP INTRO',el:$('intro-video-skip'),half:true}],compact:true};
  if(id==='engine-boot'){const w=parseFloat(($('boot-bar')||{}).style?.width)||0;return {kind:id,title:txt($('boot-logo')),lines:[txt($('boot-sub'))],progress:w/100,buttons:[]};}
  if(id==='powerup-choice'){
    const cards=Array.from(document.querySelectorAll('#powerup-cards .powerup-card')).map((el,i)=>{
      const parts=Array.from(el.children).map(c=>txt(c));
      return {id:'card'+i,el,icon:parts[0],label:parts[1],stage:parts[2],desc:parts[3]};
    });
    return {kind:id,title:'PHASE COMPLETE — CHOOSE YOUR BOON',lines:['PICK ONE • PERMANENT UPGRADE'],cards,buttons:[]};
  }
  return null;
}
/* priority list of overlays that need a VR panel */
function activeScreen(gameState){
  if(shown('powerup-choice'))return readScreen('powerup-choice');
  if(shown('pause'))return readScreen('pause');
  if(shown('gameover'))return readScreen('gameover');
  if(shown('victory'))return readScreen('victory');
  if(shown('thanks'))return readScreen('thanks');
  if(gameState==='video')return readScreen('intro-video-screen');
  if(gameState==='boot')return readScreen('engine-boot');
  if(gameState==='menu'&&shown('menu'))return readMenu();
  return null;
}

/* ---------- screen panel painter ---------- */
function drawScreen(panel,model){
  const sig=JSON.stringify([model,panel.hover]);
  panel.update(sig,(ctx,W,H)=>{
    let y=model.compact?70:110;
    text(ctx,model.title,W/2,y,{size:model.kind==='menu'?84:(model.compact?38:60),color:'#eaf6ff',glow:model.kind==='gameover'?C.crimson:C.cyan,blur:26,weight:'bold',maxWidth:W-80});
    y+=model.kind==='menu'?80:(model.compact?50:72);
    for(const line of model.lines||[]){
      if(!line)continue;
      for(const l of wrap(ctx,line,W-140,30)){text(ctx,l,W/2,y,{size:30,color:C.dim});y+=40;}
    }
    if(model.progress!==undefined){y+=20;bar(ctx,W*.2,y,W*.6,12,model.progress,C.cyan);y+=40;}
    if(model.cards&&model.cards.length){
      const n=model.cards.length,gap=24,cw=(W-72-gap*(n-1))/n,ch=H-y-40;
      model.cards.forEach((c,i)=>{
        const b={id:c.id,x:36+i*(cw+gap),y:y+6,w:cw,h:ch,el:c.el};
        const hot=panel.hover===b.id;
        frame(ctx,b.x,b.y,b.w,b.h,{r:20,fill:hot?'rgba(20,60,90,.92)':'rgba(10,6,22,.95)',stroke:hot?C.cyan:C.violet,lw:hot?6:3});
        let cy=b.y+64;
        text(ctx,c.icon,b.x+cw/2,cy,{size:72,color:'#fff'});cy+=84;
        for(const l of wrap(ctx,c.label,cw-24,34,'bold')){text(ctx,l,b.x+cw/2,cy,{size:34,color:'#c9b2ff',weight:'bold'});cy+=42;}
        text(ctx,c.stage,b.x+cw/2,cy+6,{size:24,color:C.dim});cy+=56;
        for(const l of wrap(ctx,c.desc,cw-28,32)){text(ctx,l,b.x+cw/2,cy,{size:32,color:'#e2e9ff'});cy+=40;}
        text(ctx,'TRIGGER TO CLAIM',b.x+cw/2,b.y+b.h-30,{size:22,color:hot?C.cyan:'#5f6a9a'});
        panel.addButton(b);
      });
      y=H-24;
    }else{
      y+=16;
      const btns=model.buttons||[];let i=0;
      while(i<btns.length){
        const b=btns[i];
        if(b.half&&btns[i+1]&&btns[i+1].half){
          const w=(W-200)/2,h=b.sub?104:84;
          button(panel,ctx,Object.assign({},b,{x:80,y,w,h}));
          button(panel,ctx,Object.assign({},btns[i+1],{x:120+w,y,w,h}));
          y+=h+22;i+=2;
        }else{
          const h=b.size?100:84;button(panel,ctx,Object.assign({},b,{x:W*.22,y,w:W*.56,h}));y+=h+22;i++;
        }
      }
      if(model.footer){text(ctx,model.footer,W/2,y+20,{size:22,color:'#5f6a9a',maxWidth:W-80});y+=50;}
      y=Math.min(H-8,y+20);
    }
    /* backdrop sized to the content, painted underneath */
    ctx.globalCompositeOperation='destination-over';
    frame(ctx,8,8,W-16,y-8,{r:28,fill:'rgba(6,3,16,.9)',stroke:'rgba(164,77,255,.6)',lw:4});
    ctx.globalCompositeOperation='source-over';
  });
}

/* ---------- combat HUD ---------- */
function drawHUD(panel,s){
  const sig=[s.bossName,s.bossPhase,Math.round(s.bossFrac*400),Math.round(s.hpFrac*200),Math.round(s.energyFrac*100),s.revives,
    s.cds.map(c=>Math.ceil(c.cd*4)).join(','),s.invuln?1:0].join('|');
  panel.update(sig,(ctx,W,H)=>{
    frame(ctx,6,6,W-12,H-12,{r:24,fill:'rgba(8,4,18,.62)',stroke:'rgba(120,90,200,.4)'});
    text(ctx,s.bossName,W/2,40,{size:28,color:'#ffd2d9',glow:C.crimson,weight:'bold',maxWidth:W-60});
    text(ctx,s.bossPhase,W/2,74,{size:18,color:'#a98a9a',maxWidth:W-60});
    bar(ctx,40,94,W-80,18,s.bossFrac,C.crimson);
    const lx=40,lw=W*.46;
    text(ctx,'KAEL VOSS',lx,140,{size:20,color:C.cyan,align:'left'});
    text(ctx,'REVIVES '+s.revives,lx+lw,140,{size:18,color:C.dim,align:'right'});
    bar(ctx,lx,156,lw,20,s.hpFrac,s.hpFrac<=.3?C.crimson:(s.invuln?'#bff6ff':C.cyan));
    text(ctx,'ENERGY',lx,198,{size:16,color:C.dim,align:'left'});
    bar(ctx,lx+90,191,lw-90,12,s.energyFrac,C.violet);
    const r=36,base=W*.58;
    s.cds.forEach((c,i)=>{
      const cx=base+i*(W*.14),cy=180;
      ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle='rgba(20,12,40,.9)';ctx.fill();
      ctx.lineWidth=4;ctx.strokeStyle=c.cd>0?'#3a3460':C.cyan;ctx.stroke();
      if(c.cd>0){
        const p=1-c.cd/c.max;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r-4,-Math.PI/2,-Math.PI/2+p*Math.PI*2);ctx.closePath();
        ctx.fillStyle='rgba(53,224,255,.28)';ctx.fill();
        text(ctx,Math.ceil(c.cd)+'s',cx,cy,{size:22,color:'#fff'});
      }else text(ctx,c.glyph,cx,cy,{size:30,color:'#fff',glow:C.cyan});
      text(ctx,c.button,cx,cy+r+18,{size:16,color:c.cd>0?'#5f6a9a':C.gold,weight:'bold'});
      text(ctx,c.name,cx,cy-r-14,{size:13,color:C.dim});
    });
  });
}

/* ---------- announce / subtitles / lore ---------- */
function drawBanner(panel,main,sub){
  panel.update(main+'|'+sub,(ctx,W,H)=>{
    const g=ctx.createLinearGradient(0,0,W,0);
    g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(.2,'rgba(8,4,18,.7)');g.addColorStop(.8,'rgba(8,4,18,.7)');g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;ctx.fillRect(0,H*.08,W,H*.84);
    if(main)text(ctx,main,W/2,H*.38,{size:Math.min(90,H*.36),color:'#fff',glow:C.crimson,blur:30,weight:'bold',maxWidth:W-60});
    if(sub)text(ctx,sub,W/2,main?H*.74:H/2,{size:main?32:40,color:'#ffd9a0',glow:'rgba(255,120,60,.8)',maxWidth:W-60});
  });
}
function drawSubtitle(panel,who,line,hint){
  panel.update(who+'|'+line+'|'+hint,(ctx,W,H)=>{
    if(!who&&!line&&!hint)return;
    if(who||line){
      frame(ctx,4,4,W-8,H-8,{r:20,fill:'rgba(4,2,12,.78)',stroke:'rgba(164,77,255,.45)'});
      let y=who?46:H/2-(wrap(ctx,line,W-80,30).length-1)*19;
      if(who){text(ctx,who,W/2,y,{size:24,color:C.crimson,weight:'bold'});y+=42;}
      for(const l of wrap(ctx,line,W-80,30)){text(ctx,l,W/2,y,{size:30,color:'#eef'});y+=38;}
    }
    if(hint)text(ctx,hint,W-24,H-22,{size:18,color:C.gold,align:'right'});
  });
}
function drawLore(panel,line,final){
  panel.update(line,(ctx,W,H)=>{
    if(!line)return;
    let y=H/2-(wrap(ctx,line,W-80,final?54:44).length-1)*28;
    for(const l of wrap(ctx,line,W-80,final?54:44)){text(ctx,l,W/2,y,{size:final?54:44,color:final?'#ffd2d9':'#cfe6ff',glow:final?C.crimson:C.cyan,blur:24});y+=58;}
  });
}

window.AWVRUI={Panel,C,text,wrap,frame,bar,roundRect,activeScreen,drawScreen,drawHUD,drawBanner,drawSubtitle,drawLore,shown};
})();
