/* ABYSSWALKER VR — offline cache.
   Code/HTML: network-first (updates land when online).
   Audio + three.js: cache-first (precached on install).
   intro.mp4 (72 MB, range-streamed) is left to the network; offline the game skips it. */
const VERSION='aw-vr-v1';
const CORE=['./','index.html','vr-core.js','vr-ui.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];
const AUDIO=['Start_Menu.mp3','Main_Menu.mp3','Boss_one.mp3','Boss_two.mp3','Boss_three.mp3','Boss_four.mp3','Boss_five.mp3',
  'End_Credits.mp3','transition_cutscenes.mp3','bossone_am.mp3','bosstwo_am.mp3','bossthree_am.mp3','bossfour_am.mp3','bossfive_am.mp3',
  'player_jump.mp3','player_dash.mp3','player_hurt.mp3','boss_hit.mp3','bossreveal_sound.mp3','overcharge_blast.mp3',
  'celestial_judgement.mp3','astral_shift.mp3','bossthree_laugh.mp3'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE).then(()=>Promise.all(AUDIO.map(u=>c.add(u).catch(()=>{}))))));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.pathname.endsWith('.mp4'))return;
  const isCode=req.mode==='navigate'||/\.(html|js|webmanifest)$/.test(url.pathname)&&url.origin===location.origin;
  if(isCode){
    e.respondWith(fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(VERSION).then(c=>c.put(req,copy));}return res;})
      .catch(()=>caches.match(req,{ignoreSearch:true}).then(hit=>hit||caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req.url,{ignoreSearch:true}).then(hit=>hit||fetch(req).then(res=>{
    if(res.status===200){const copy=res.clone();caches.open(VERSION).then(c=>c.put(req.url,copy));}
    return res;
  })));
});
