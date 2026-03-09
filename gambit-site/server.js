// ===== GAMBIT.GG SERVER =====
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const https = require('https');
const WebSocket = require('ws');

const Bans  = require('./Moderation/bans');
const Mutes = require('./Moderation/mutes');

const PORT = 3000;

const SITE_CONFIG = { owner: ['8297795710'], admin: [] };

function getUserRole(uid) {
  if (!uid) return 'user';
  const id = String(uid);
  if (SITE_CONFIG.owner.includes(id)) return 'owner';
  if (SITE_CONFIG.admin.includes(id)) return 'admin';
  return 'user';
}
function isAdminRole(r) { return r === 'owner' || r === 'admin'; }

// ===== SLUR LIST (auto-mute 5min) =====
const SLURS = ['nigger','nigga','faggot','retard','chink','spic','kike','tranny','cunt'];
function containsSlur(text) { const t = text.toLowerCase(); return SLURS.some(s => t.includes(s)); }

// ===== STATE =====
let chatHistory   = [];
let maintenanceOn = false;
let coinflips     = [];
let jackpots      = [];   // active jackpot entries
let modLog        = [];   // last 200 mod actions
const MAX_CHAT    = 50;
const MAX_MSG_LEN = 200;
const RATE_MS     = 5000; // 5 second chat cooldown

// Per-user: { lastMs, lastText, ip }
const rateMap   = {};

// leaderboard: userId → { username, avatar, totalBet, profit, streak, wins, losses, flips }
const leaderboard = {};

function updateLB(userId, username, avatar, delta) {
  if (!leaderboard[userId]) leaderboard[userId] = { username, avatar, totalBet:0, profit:0, streak:0, wins:0, losses:0, flips:0, bestStreak:0 };
  const e = leaderboard[userId];
  e.username = username; e.avatar = avatar;
  e.flips++;
  e.totalBet += Math.abs(delta);
  if (delta > 0) { e.wins++; e.profit += delta; e.streak = Math.max(0,e.streak)+1; e.bestStreak = Math.max(e.bestStreak,e.streak); }
  else            { e.losses++; e.profit += delta; e.streak = 0; }
}

function getLeaderboards() {
  const all = Object.values(leaderboard);
  return {
    mostBet:    [...all].sort((a,b)=>b.totalBet-a.totalBet).slice(0,10),
    mostProfit: [...all].sort((a,b)=>b.profit-a.profit).slice(0,10),
    mostStreak: [...all].sort((a,b)=>b.bestStreak-a.bestStreak).slice(0,10)
  };
}

function addModLog(entry) {
  modLog.unshift({ ...entry, time: new Date().toISOString() });
  if (modLog.length > 200) modLog = modLog.slice(0,200);
}

// ===== ONLINE DEBOUNCE =====
let onlineTimer = null;
function scheduleOnline() {
  if (onlineTimer) return;
  onlineTimer = setTimeout(() => { onlineTimer=null; broadcastAll({ type:'online', count: wss?wss.clients.size:0 }); }, 2000);
}

// ===== PROVABLY FAIR =====
const crypto = require('crypto');
function makeSeed() { return crypto.randomBytes(16).toString('hex'); }
function resolveFlip(serverSeed, clientSeed, nonce) {
  const hash = crypto.createHmac('sha256', serverSeed).update(clientSeed + ':' + nonce).digest('hex');
  const val  = parseInt(hash.slice(0,8), 16);
  return val % 2 === 0 ? 'heads' : 'tails';
}

function sanitize(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').trim();
}

function robloxGet(url) {
  return new Promise((resolve,reject) => {
    https.get(url,{headers:{'Accept':'application/json'}},res=>{
      let b=''; res.on('data',c=>b+=c); res.on('end',()=>{ try{resolve(JSON.parse(b));}catch(e){reject(e);} });
    }).on('error',reject);
  });
}
function robloxPost(url,payload) {
  return new Promise((resolve,reject) => {
    const data=JSON.stringify(payload); const u=new URL(url);
    const req=https.request({hostname:u.hostname,path:u.pathname+u.search,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{
      let b=''; res.on('data',c=>b+=c); res.on('end',()=>{ try{resolve(JSON.parse(b));}catch(e){reject(e);} });
    }); req.on('error',reject); req.write(data); req.end();
  });
}

const MIME = { '.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.mp3':'audio/mpeg' };

// ===== HTTP =====
const server = http.createServer(async (req,res) => {
  const url = req.url;

  // ── API: lookup-id (username → id) ────────────────────────
  if (url.startsWith('/api/lookup-id') && req.method==='POST') {
    let b=''; req.on('data',c=>b+=c);
    req.on('end', async()=>{
      try {
        const p=JSON.parse(b);
        const d=await robloxPost('https://users.roblox.com/v1/usernames/users',{usernames:[p.username],excludeBannedUsers:false});
        if(!d.data||!d.data.length){ res.writeHead(404,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:'User not found'})); return; }
        const u=d.data[0]; res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({id:String(u.id),username:u.name}));
      } catch(e){ res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    }); return;
  }

  // ── API: lookup (sign-in) ──────────────────────────────────
  if (url.startsWith('/api/lookup') && req.method==='POST') {
    let b=''; req.on('data',c=>b+=c);
    req.on('end', async()=>{
      try {
        const p=JSON.parse(b);
        const d=await robloxPost('https://users.roblox.com/v1/usernames/users',{usernames:[p.username],excludeBannedUsers:false});
        res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(d));
      } catch(e){ res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    }); return;
  }

  if (url.startsWith('/api/user/') && req.method==='GET') {
    const id=url.replace('/api/user/','').split('?')[0];
    try { const d=await robloxGet('https://users.roblox.com/v1/users/'+id); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(d)); }
    catch(e){ res.writeHead(500); res.end(JSON.stringify({error:e.message})); } return;
  }

  if (url.startsWith('/api/avatar/') && req.method==='GET') {
    const id=url.replace('/api/avatar/','').split('?')[0];
    try { const d=await robloxGet('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds='+id+'&size=150x150&format=Png&isCircular=false'); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(d)); }
    catch(e){ res.writeHead(500); res.end(JSON.stringify({error:e.message})); } return;
  }

  // ── API: leaderboard ──────────────────────────────────────
  if (url === '/api/leaderboard' && req.method==='GET') {
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(getLeaderboards())); return;
  }

  // ── API: mod log (owner/admin only via query param auth) ──
  if (url.startsWith('/api/modlog') && req.method==='GET') {
    const qs  = new URL('http://x'+url).searchParams;
    const uid = qs.get('uid')||'';
    if (!isAdminRole(getUserRole(uid))) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(modLog)); return;
  }

  // Static files
  let fp = url==='/' ? '/index.html' : url.split('?')[0];
  fp = path.join(__dirname,'public',fp);
  const ext=path.extname(fp); const mime=MIME[ext]||'text/plain';
  fs.readFile(fp,(err,data)=>{ if(err){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'Content-Type':mime}); res.end(data); });
});

// ===== WS =====
const wss = new WebSocket.Server({ server });

function broadcastAll(data) { const m=JSON.stringify(data); wss.clients.forEach(c=>{ if(c.readyState===WebSocket.OPEN) c.send(m); }); }
function sendTo(ws,data)    { if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(data)); }

wss.on('connection',(ws,req)=>{
  sendTo(ws,{ type:'init', chatHistory, maintenanceOn, coinflips, jackpots, onlineCount:wss.clients.size });
  scheduleOnline();
  ws.on('close',()=>{ scheduleOnline(); });
  ws.on('message',raw=>{
    let msg; try{ msg=JSON.parse(raw); }catch(e){ return; }
    if(!msg||!msg.type) return;
    const uid  = msg.userId ? String(msg.userId) : null;
    const role = uid ? getUserRole(uid) : 'user';

    switch(msg.type) {

      // ── CHAT ────────────────────────────────────────────
      case 'chat': {
        if(!uid||!msg.username||!msg.text) return;
        if(Bans.check(uid)){ const b=Bans.get(uid); sendTo(ws,{type:'error',text:'You are banned'+(b&&b.reason?': '+b.reason:'.')}); return; }
        if(Mutes.check(uid)){ sendTo(ws,{type:'error',text:'You are muted.'}); return; }
        if(maintenanceOn&&!isAdminRole(role)){ sendTo(ws,{type:'error',text:'Chat disabled during maintenance.'}); return; }

        const clean = sanitize(msg.text).slice(0,MAX_MSG_LEN);
        if(!clean) return;

        // Auto-mute slurs 5 min
        if(containsSlur(clean)) {
          Mutes.add(uid,{username:sanitize(msg.username),mutedBy:'AutoMod',duration:'5m'});
          addModLog({action:'auto-mute',targetId:uid,targetName:sanitize(msg.username),reason:'Slur detected',duration:'5m',by:'AutoMod'});
          sendTo(ws,{type:'modAction',action:'mute',targetId:uid,targetName:sanitize(msg.username),duration:'5m',byName:'AutoMod'});
          sendTo(ws,{type:'error',text:'Auto-muted 5 minutes for using a slur.'});
          return;
        }

        // Rate limit 5s
        const now=Date.now(); const prev=rateMap[uid]||{lastMs:0,lastText:''};
        if(now-prev.lastMs<RATE_MS){ sendTo(ws,{type:'error',text:'Slow down — 1 message per 5 seconds.'}); return; }
        if(clean===prev.lastText){ sendTo(ws,{type:'error',text:'Do not repeat the same message.'}); return; }
        rateMap[uid]={lastMs:now,lastText:clean};

        const entry={type:'chat',username:sanitize(msg.username),text:clean,avatar:msg.avatar||'',userId:uid,role};
        chatHistory.push(entry); if(chatHistory.length>MAX_CHAT) chatHistory=chatHistory.slice(-MAX_CHAT);
        broadcastAll(entry); break;
      }

      // ── ANNOUNCE ─────────────────────────────────────────
      case 'announce': {
        if(!uid||!isAdminRole(role)) return;
        const text=sanitize(msg.text||'').slice(0,300); if(!text) return;
        broadcastAll({type:'announce',text,senderName:sanitize(msg.username||''),senderRole:role}); break;
      }

      // ── BAN ──────────────────────────────────────────────
      case 'ban': {
        if(!uid||!isAdminRole(role)||!msg.targetId) return;
        const tid=String(msg.targetId);
        if(Bans.check(tid)){
          Bans.remove(tid);
          addModLog({action:'unban',targetId:tid,targetName:sanitize(msg.targetUsername||tid),by:sanitize(msg.username||'')});
          broadcastAll({type:'modAction',action:'unban',targetId:tid,targetName:sanitize(msg.targetUsername||tid),byName:sanitize(msg.username||'')}); break;
        }
        const reason=sanitize(msg.reason||'No reason provided').slice(0,200);
        Bans.add(tid,{username:sanitize(msg.targetUsername||tid),bannedBy:sanitize(msg.username||''),reason,duration:msg.duration||'perm'});
        addModLog({action:'ban',targetId:tid,targetName:sanitize(msg.targetUsername||tid),reason,duration:msg.duration||'perm',by:sanitize(msg.username||'')});
        broadcastAll({type:'modAction',action:'ban',targetId:tid,targetName:sanitize(msg.targetUsername||tid),reason,duration:msg.duration||'perm',byName:sanitize(msg.username||'')}); break;
      }

      // ── MUTE ─────────────────────────────────────────────
      case 'mute': {
        if(!uid||!isAdminRole(role)||!msg.targetId) return;
        const tid=String(msg.targetId);
        if(Mutes.check(tid)){
          Mutes.remove(tid);
          addModLog({action:'unmute',targetId:tid,targetName:sanitize(msg.targetUsername||tid),by:sanitize(msg.username||'')});
          broadcastAll({type:'modAction',action:'unmute',targetId:tid,targetName:sanitize(msg.targetUsername||tid),byName:sanitize(msg.username||'')}); break;
        }
        Mutes.add(tid,{username:sanitize(msg.targetUsername||tid),mutedBy:sanitize(msg.username||''),duration:msg.duration||'1h'});
        addModLog({action:'mute',targetId:tid,targetName:sanitize(msg.targetUsername||tid),duration:msg.duration||'1h',by:sanitize(msg.username||'')});
        broadcastAll({type:'modAction',action:'mute',targetId:tid,targetName:sanitize(msg.targetUsername||tid),duration:msg.duration||'1h',byName:sanitize(msg.username||'')}); break;
      }

      // ── MAINTENANCE ───────────────────────────────────────
      case 'maintenance': {
        if(!uid||role!=='owner') return;
        maintenanceOn=!!msg.enabled; broadcastAll({type:'maintenance',enabled:maintenanceOn}); break;
      }

      // ── CF CREATE ─────────────────────────────────────────
      case 'cf_create': {
        if(!msg.cf||!uid) return;
        if(maintenanceOn&&!isAdminRole(role)) return;
        if(coinflips.find(c=>c.id===msg.cf.id)) return;
        // Attach provably fair seeds
        const serverSeed=makeSeed(); const clientSeed=makeSeed(); const nonce=Date.now();
        msg.cf._serverSeed=serverSeed; msg.cf._clientSeed=clientSeed; msg.cf._nonce=nonce;
        msg.cf._serverSeedHash=crypto.createHash('sha256').update(serverSeed).digest('hex');
        coinflips.push(msg.cf); broadcastAll({type:'cf_update',coinflips}); break;
      }

      // ── CF CANCEL ─────────────────────────────────────────
      case 'cf_cancel': {
        if(!msg.id) return;
        coinflips=coinflips.filter(c=>c.id!==msg.id); broadcastAll({type:'cf_update',coinflips}); break;
      }

      // ── CF JOIN ───────────────────────────────────────────
      case 'cf_join': {
        if(!msg.id||!uid) return;
        if(maintenanceOn&&!isAdminRole(role)) return;
        const idx=coinflips.findIndex(c=>c.id===msg.id); if(idx===-1) return;
        const cf=coinflips[idx];
        if(String(cf.creatorId)===uid){ sendTo(ws,{type:'error',text:'You cannot join your own coinflip.'}); return; }
        coinflips.splice(idx,1);
        const flip=resolveFlip(cf._serverSeed,cf._clientSeed,cf._nonce);
        const creatorWon=flip===cf.side;
        // Update leaderboard
        updateLB(cf.creatorId,cf.creator,cf.avatar||'', creatorWon?10:-10);
        updateLB(uid,sanitize(msg.username||''),msg.avatar||'', creatorWon?-10:10);
        broadcastAll({type:'cf_result',id:cf.id,creatorId:cf.creatorId,creatorName:cf.creator,creatorAvatar:cf.avatar||'',joinerId:uid,joinerName:sanitize(msg.username||''),joinerAvatar:msg.avatar||'',flip,creatorWon,coinflips,
          fairness:{serverSeed:cf._serverSeed,clientSeed:cf._clientSeed,nonce:cf._nonce,serverSeedHash:cf._serverSeedHash}}); break;
      }

      // ── JACKPOT JOIN ──────────────────────────────────────
      case 'jp_join': {
        if(!uid||!msg.username) return;
        if(maintenanceOn&&!isAdminRole(role)) return;
        if(jackpots.find(e=>e.userId===uid)) return; // already in
        jackpots.push({userId:uid,username:sanitize(msg.username),avatar:msg.avatar||'',amount:msg.amount||10});
        broadcastAll({type:'jp_update',jackpots});
        // Auto-resolve after 30s if 2+ players
        if(jackpots.length>=2) setTimeout(resolveJackpot,30000);
        break;
      }

      // ── JACKPOT CANCEL (own entry) ────────────────────────
      case 'jp_leave': {
        if(!uid) return;
        jackpots=jackpots.filter(e=>e.userId!==uid); broadcastAll({type:'jp_update',jackpots}); break;
      }
    }
  });
});

function resolveJackpot() {
  if(jackpots.length<2) return;
  const pool=jackpots.slice();
  jackpots=[];
  // Weighted random
  const totalTickets=pool.reduce((s,e)=>s+e.amount,0);
  let r=Math.floor(Math.random()*totalTickets); let winner=pool[pool.length-1];
  for(const e of pool){ r-=e.amount; if(r<0){winner=e;break;} }
  const totalPot=pool.reduce((s,e)=>s+e.amount,0);
  pool.forEach(e=>updateLB(e.userId,e.username,e.avatar, e.userId===winner.userId?(totalPot-e.amount):-e.amount));
  broadcastAll({type:'jp_result',winner,pool,totalPot,coinflips:[],jackpots:[]});
}

server.listen(PORT, ()=>console.log('\n  Gambit.gg → http://localhost:'+PORT+'\n'));
