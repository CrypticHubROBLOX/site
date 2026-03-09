// ===== CONFIG =====
var SITE_CONFIG = { owner: ['8297795710'], admin: [] };

var WORDS = [
  'silent','marble','galaxy','neon','drift','velvet','shadow','ember','frost','blaze',
  'crystal','vapor','onyx','lunar','prism','cascade','echo','cipher','nova','phantom',
  'raven','storm','titan','void','apex','comet','delta','forge','glitch','haven',
  'iron','jade','karma','lumen','mirage','nexus','orbit','pulse','quartz','relay',
  'solar','torque','ultra','viper','wrath','xenon','yield','zenith','amber','bliss',
  'chrome','dusk','eden','flux','grove','helix','ionic','jewel','knave','lance',
  'magna','nimbus','ozone','pixel','quest','rift','surge','tidal','umbra','valor',
  'weave','xero','yonder','zeal','arctic','bolt','cliff','dawn','eagle','flare',
  'glyph','helm','ivy','jinx','kite','lyric','mirth','night','opal','pine',
  'quill','rush','sage','thorn','unity','verge','wind','yarn','zone','abyss'
];

// ===== STATE =====
var currentUser      = null;
var verifyPhraseText = '';
var selectedSide     = '';
var coinflips        = [];
var jackpots         = [];
var selectedDuration = '1h';
var activeBattleId   = null;
var ws               = null;
var pendingInit      = null;
var currentGame      = 'coinflip';
var lbCurrentTab     = 'bet';
var cfHistory        = []; // last 20 completed flips

// ===== SOUND =====
function playSound(id) {
  try { var a=document.getElementById(id); if(a){ a.currentTime=0; a.volume=0.35; a.play().catch(function(){}); } } catch(e){}
}

// ===== ROLES =====
function getUserRole(uid) {
  if (!uid) return 'user';
  var s=String(uid);
  if (SITE_CONFIG.owner.indexOf(s)!==-1) return 'owner';
  if (SITE_CONFIG.admin.indexOf(s) !==-1) return 'admin';
  return 'user';
}
function myRole()   { return currentUser ? getUserRole(currentUser.id) : 'user'; }
function iAmOwner() { return myRole()==='owner'; }
function iAmAdmin() { return myRole()==='owner'||myRole()==='admin'; }
function cap(s)     { return s ? s.charAt(0).toUpperCase()+s.slice(1) : ''; }
function esc(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ===== WEBSOCKET =====
var wsReconnectTimer = null;
function connectWS() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer=null; }
  var proto=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(proto+'://'+location.host);
  ws.onopen  = function() { if(wsReconnectTimer){clearTimeout(wsReconnectTimer);wsReconnectTimer=null;} };
  ws.onclose = function() { wsReconnectTimer=setTimeout(connectWS,2000); };
  ws.onerror = function() { ws.close(); };
  ws.onmessage = function(e) { var m; try{m=JSON.parse(e.data);}catch(x){return;} onWS(m); };
}
function wsSend(obj) { if(ws&&ws.readyState===1) ws.send(JSON.stringify(obj)); }

function onWS(msg) {
  switch(msg.type) {
    case 'init':
      pendingInit=msg;
      if (document.getElementById('coinflipPage').style.display!=='none' ||
          document.getElementById('main').style.display!=='none') runInit();
      break;
    case 'online':   setOnline(msg.count); break;
    case 'chat':     addChat(msg);  break;
    case 'announce': showBanner(msg.senderRole,msg.senderName,msg.text); break;
    case 'modAction':
      if (currentUser && String(currentUser.id)===String(msg.targetId)) {
        if (msg.action==='ban')    showModBanner('ban',msg.duration,msg.reason||'');
        else if (msg.action==='mute') {
          showModBanner('mute',msg.duration,'');
          currentUser.isMuted=true; saveSession(); refreshMuteEmoji();
        } else if (msg.action==='unmute') {
          currentUser.isMuted=false; saveSession(); refreshMuteEmoji(); dismissNotif();
        }
      }
      break;
    case 'cf_update':
      coinflips=msg.coinflips||[]; renderCF(); break;
    case 'cf_result':
      onCFResult(msg); break;
    case 'jp_update':
      jackpots=msg.jackpots||[]; renderJackpot(); break;
    case 'jp_result':
      onJPResult(msg); break;
    case 'maintenance':
      if (msg.enabled) { if(!iAmAdmin()) showMaint(); }
      else { if(document.getElementById('maintenancePage').style.display!=='none') hideMaint(); setMaintUI(false); }
      if (iAmAdmin()) setMaintUI(msg.enabled);
      break;
    case 'error': chatFlash(msg.text); break;
  }
}

function runInit() {
  if (!pendingInit) return;
  var d=pendingInit;
  ['chatMessages','chatMessagesCF'].forEach(function(id){ var el=document.getElementById(id); if(el) el.innerHTML=''; });
  (d.chatHistory||[]).forEach(function(m){ if(m.type==='chat') addChat(m); });
  setOnline(d.onlineCount||0);
  coinflips=d.coinflips||[]; renderCF();
  jackpots=d.jackpots||[];  renderJackpot();
  if (d.maintenanceOn&&!iAmAdmin()) showMaint();
}

// ===== INTRO =====
window.addEventListener('load', function() {
  connectWS();
  var logo=document.getElementById('introLogo'); var delay=0;
  'Gambit.gg'.split('').forEach(function(ch,i) {
    var s=document.createElement('span');
    s.className='letter '+(i<6?'letter-white':'letter-purple');
    s.textContent=ch; s.style.animationDelay=delay+'s'; delay+=0.08; logo.appendChild(s);
  });
  setTimeout(function() {
    var intro=document.getElementById('intro'); intro.classList.add('fading');
    setTimeout(function() {
      intro.style.display='none';
      var raw=localStorage.getItem('gambit_user'); var u=null;
      if(raw){ try{u=JSON.parse(raw);}catch(x){} }
      if(u&&u.id) {
        currentUser=u;
        fetch('/api/avatar/'+u.id).then(function(r){return r.json();}).then(function(data){
          if(data.data&&data.data[0]) currentUser.avatar=data.data[0].imageUrl;
          saveSession(); goToCoinflip();
        }).catch(function(){ goToCoinflip(); });
      } else { goToLanding(); }
    },700);
  },2800);
});

// ===== PAGE TRANSITIONS =====
function goToLanding() {
  document.getElementById('maintenancePage').style.display='none';
  document.getElementById('coinflipPage').style.display='none';
  document.getElementById('main').style.display='flex';
  runInit();
}
function goToCoinflip() {
  document.getElementById('main').style.display='none';
  document.getElementById('maintenancePage').style.display='none';
  document.getElementById('coinflipPage').style.display='flex';
  var img=document.getElementById('navAvatar');
  if(img){img.src=currentUser.avatar||'';img.style.display='inline-block';}
  var nu=document.getElementById('navUsername'); if(nu) nu.textContent=currentUser.username;
  var adminTab=document.getElementById('pmAdminTabBtn');
  var maintCard=document.getElementById('maintCard');
  if(iAmAdmin()){ if(adminTab)adminTab.style.display='inline-block'; if(maintCard&&iAmOwner())maintCard.style.display='block'; }
  else { if(adminTab)adminTab.style.display='none'; if(maintCard)maintCard.style.display='none'; }
  refreshMuteEmoji();
  showGame(currentGame);
  runInit();
}

// ===== GAME TABS =====
function showGame(name) {
  currentGame=name;
  ['coinflip','jackpot'].forEach(function(g) {
    var panel=document.getElementById('game'+cap(g));
    var btn=document.getElementById('nav'+cap(g));
    if(panel) panel.style.display=(g===name?'flex':'none');
    if(btn){ btn.classList.toggle('active-link',g===name); }
  });
  if(name==='jackpot') renderJackpot();
}

// ===== SESSION =====
function saveSession()  { if(currentUser) localStorage.setItem('gambit_user',JSON.stringify(currentUser)); }
function clearSession() { localStorage.removeItem('gambit_user'); }

// ===== MAINTENANCE =====
function showMaint() {
  document.getElementById('maintenancePage').style.display='flex';
  document.getElementById('main').style.display='none';
  document.getElementById('coinflipPage').style.display='none';
}
function hideMaint() {
  document.getElementById('maintenancePage').style.display='none';
  if(currentUser) goToCoinflip(); else goToLanding();
}
function toggleMaintenance() {
  if(!iAmOwner()) return;
  var isOn=document.getElementById('maintStatus').classList.contains('on');
  wsSend({type:'maintenance',userId:currentUser.id,enabled:!isOn}); setMaintUI(!isOn);
}
function setMaintUI(on) {
  var s=document.getElementById('maintStatus'); var b=document.getElementById('maintToggleBtn'); if(!s||!b) return;
  s.textContent=on?'On':'Off'; if(on)s.classList.add('on'); else s.classList.remove('on');
  b.textContent=on?'Disable':'Enable';
}

// ===== SIGN-IN =====
function openModal() { document.getElementById('modal').style.display='flex'; goStep(0); }
function closeModal() { document.getElementById('modal').style.display='none'; }
function closeModalOutside(e) { if(e.target===document.getElementById('modal')) closeModal(); }
function goStep(n) {
  ['stepChoose','stepUsername','stepConfirm','stepVerify'].forEach(function(id,i){ document.getElementById(id).style.display=i===n?'flex':'none'; });
  if(n===1) setTimeout(function(){ var el=document.getElementById('robloxUsernameInput'); if(el)el.focus(); },50);
}
function lookupUser() {
  var username=document.getElementById('robloxUsernameInput').value.trim(); if(!username) return;
  var errEl=document.getElementById('lookupError'); var btn=document.getElementById('lookupBtn'); var btnTx=document.getElementById('lookupBtnText');
  errEl.style.display='none'; btn.disabled=true; btnTx.textContent='Searching...';
  fetch('/api/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username})})
    .then(function(r){return r.json();}).then(function(data){
      btn.disabled=false; btnTx.textContent='Search';
      if(!data.data||!data.data.length){ errEl.textContent='User not found.'; errEl.style.display='block'; return; }
      var user=data.data[0];
      currentUser={id:String(user.id),username:user.name,avatar:'',wins:0,losses:0,flips:0,totalBet:0,profit:0,inventory:[],isMuted:false};
      document.getElementById('confirmUsername').textContent=user.name;
      document.getElementById('confirmId').textContent='ID: '+user.id;
      fetch('/api/avatar/'+user.id).then(function(r){return r.json();}).then(function(d){
        currentUser.avatar=(d.data&&d.data[0])?d.data[0].imageUrl:'';
        document.getElementById('confirmAvatar').src=currentUser.avatar; goStep(2);
      });
    }).catch(function(){ btn.disabled=false; btnTx.textContent='Search'; errEl.textContent='Network error.'; errEl.style.display='block'; });
}
function generatePhrase() {
  var pool=WORDS.slice(),words=[],n=5+Math.floor(Math.random()*4);
  while(words.length<n){ var i=Math.floor(Math.random()*pool.length); words.push(pool.splice(i,1)[0]); }
  verifyPhraseText='Gambit.gg | '+words.join(' ');
  document.getElementById('verifyPhrase').textContent=verifyPhraseText;
  document.getElementById('profileLink').href='https://www.roblox.com/users/'+currentUser.id+'/profile';
  document.getElementById('verifyError').style.display='none';
  document.getElementById('verifySuccess').style.display='none';
  goStep(3);
}
function copyPhrase() {
  navigator.clipboard.writeText(verifyPhraseText).catch(function(){ var t=document.createElement('textarea'); t.value=verifyPhraseText; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); });
  var b=document.querySelector('.phrase-copy-btn'); if(b){b.textContent='Copied!';setTimeout(function(){b.textContent='Copy';},1500);}
}
function verifyPhrase() {
  var errEl=document.getElementById('verifyError'); var succEl=document.getElementById('verifySuccess');
  var btn=document.getElementById('verifyBtn'); var btnTx=document.getElementById('verifyBtnText');
  errEl.style.display='none'; succEl.style.display='none'; btn.disabled=true; btnTx.textContent='Checking...';
  fetch('/api/user/'+currentUser.id).then(function(r){return r.json();}).then(function(data){
    btn.disabled=false; btnTx.textContent='Verify';
    if((data.description||'').indexOf(verifyPhraseText)!==-1){
      succEl.style.display='block';
      setTimeout(function(){ closeModal(); saveSession(); goToCoinflip(); },1000);
    } else {
      errEl.textContent='Phrase not found in your Roblox profile. Paste it there, save, then hit Verify.'; errEl.style.display='block';
    }
  }).catch(function(){ btn.disabled=false; btnTx.textContent='Verify'; errEl.textContent='Network error.'; errEl.style.display='block'; });
}

// ===== COINFLIP LIST =====
function renderCF() {
  var list=document.getElementById('cfList'); if(!list) return;
  if(!coinflips.length) { list.innerHTML='<div class="cf-empty"><p>No active coinflips. Be the first to create one!</p></div>'; return; }
  list.innerHTML='';
  coinflips.forEach(function(cf) {
    var mine=currentUser&&cf.creatorId===currentUser.id;
    var d=document.createElement('div'); d.className='cf-row';
    d.innerHTML=
      '<img class="cf-row-avatar" src="'+(cf.avatar||'')+'" alt="" onclick="showPlayerPopup(\''+esc(cf.creator)+'\',\''+esc(cf.avatar||'')+'\',0,0,0,0,0,\''+esc(cf.creatorId)+'\')" />'+
      '<div class="cf-row-info"><div class="cf-row-name">'+cf.creator+'</div><div class="cf-row-side">'+cap(cf.side)+'</div></div>'+
      '<div class="cf-row-items"><div class="cf-item-slot">+</div><div class="cf-item-slot">+</div><div class="cf-item-slot">+</div></div>'+
      '<div class="cf-row-actions">'+
        '<button class="cf-row-view" onclick="openCFBattle(\''+esc(cf.id)+'\',false)">View</button>'+
        (mine
          ? '<button class="cf-row-cancel" onclick="cancelCF(\''+esc(cf.id)+'\')">Cancel</button>'
          : '<button class="cf-row-join" onclick="openCFBattle(\''+esc(cf.id)+'\',true)">Join</button>')+
      '</div>';
    list.appendChild(d);
  });
}

function openCreateCF() {
  selectedSide='';
  document.getElementById('sideHeads').classList.remove('selected');
  document.getElementById('sideTails').classList.remove('selected');
  document.getElementById('cfCreateError').style.display='none';
  document.getElementById('createCFModal').style.display='flex';
}
function closeCreateCF()         { document.getElementById('createCFModal').style.display='none'; }
function closeCreateCFOutside(e) { if(e.target===document.getElementById('createCFModal')) closeCreateCF(); }
function selectSide(s) {
  selectedSide=s;
  document.getElementById('sideHeads').classList.toggle('selected',s==='heads');
  document.getElementById('sideTails').classList.toggle('selected',s==='tails');
}
function submitCreateCF() {
  if(!selectedSide){ var e=document.getElementById('cfCreateError'); e.textContent='Choose a side first.'; e.style.display='block'; return; }
  var cf={id:'cf_'+Date.now()+'_'+Math.floor(Math.random()*9999),creator:currentUser.username,creatorId:currentUser.id,avatar:currentUser.avatar||'',side:selectedSide};
  wsSend({type:'cf_create',cf:cf}); closeCreateCF();
  if(!coinflips.find(function(c){return c.id===cf.id;})) coinflips.push(cf);
  renderCF(); openCFBattle(cf.id,false);
}
function cancelCF(id) {
  wsSend({type:'cf_cancel',id:id}); coinflips=coinflips.filter(function(c){return c.id!==id;}); renderCF();
  if(activeBattleId===id) closeCFBattle();
}

// ===== CF BATTLE MODAL =====
function openCFBattle(id, joining) {
  var cf=null; for(var i=0;i<coinflips.length;i++){if(coinflips[i].id===id){cf=coinflips[i];break;}}
  if(!cf) return;
  activeBattleId=id;
  document.getElementById('cfBattleId').textContent='#'+id.slice(-6).toUpperCase();
  var la=document.getElementById('cfBattleLeftAvatar'); la.src=cf.avatar||''; la.style.borderColor=''; la.style.boxShadow='';
  document.getElementById('cfBattleLeftName').textContent=cf.creator;
  document.getElementById('cfBattleLeftSide').textContent=cap(cf.side);
  document.getElementById('cfBattleLeft').classList.remove('highlight');
  document.getElementById('cfBattleRightPlaceholder').style.display='flex';
  var ra=document.getElementById('cfBattleRightAvatar'); ra.style.display='none'; ra.src=''; ra.style.borderColor=''; ra.style.boxShadow='';
  document.getElementById('cfBattleRightName').textContent='Waiting...';
  document.getElementById('cfBattleRightSide').textContent='';
  document.getElementById('cfBattleRight').classList.remove('highlight');
  document.getElementById('cfBattleResult').style.display='none';
  document.getElementById('cfBattleJoinBtn').style.display=joining?'block':'none';
  document.getElementById('cfBattleItems').innerHTML='<div class="cf-battle-item-slot">+</div><div class="cf-battle-item-slot">+</div><div class="cf-battle-item-slot">+</div>';
  // Show provably fair hash
  var fairRow=document.getElementById('cfFairRow'); var fairHash=document.getElementById('cfFairHash');
  var fairReveal=document.getElementById('cfFairReveal');
  if(cf._serverSeedHash){ fairHash.textContent=cf._serverSeedHash; fairRow.style.display='flex'; }
  else fairRow.style.display='none';
  fairReveal.style.display='none';
  document.getElementById('cfCoinWrap').style.display='none';
  document.getElementById('cfBattleModal').style.display='flex';
}
function closeCFBattle()         { document.getElementById('cfBattleModal').style.display='none'; activeBattleId=null; }
function closeCFBattleOutside(e) { if(e.target===document.getElementById('cfBattleModal')) closeCFBattle(); }

function joinFromBattle() {
  if(!activeBattleId||!currentUser) return;
  var cf=null; for(var i=0;i<coinflips.length;i++){if(coinflips[i].id===activeBattleId){cf=coinflips[i];break;}}
  if(!cf) return;
  var oppSide=cf.side==='heads'?'tails':'heads';
  document.getElementById('cfBattleRightPlaceholder').style.display='none';
  var ra=document.getElementById('cfBattleRightAvatar'); ra.src=currentUser.avatar||''; ra.style.display='block';
  document.getElementById('cfBattleRightName').textContent=currentUser.username;
  document.getElementById('cfBattleRightSide').textContent=cap(oppSide);
  document.getElementById('cfBattleJoinBtn').style.display='none';
  document.getElementById('cfBattleLeft').classList.add('highlight');
  document.getElementById('cfBattleRight').classList.add('highlight');
  wsSend({type:'cf_join',id:activeBattleId,userId:currentUser.id,username:currentUser.username,avatar:currentUser.avatar||''});
}

// ===== CF HISTORY =====
function addCFHistory(msg) {
  cfHistory.unshift({
    creatorName:   msg.creatorName   || '',
    creatorAvatar: msg.creatorAvatar || '',
    joinerName:    msg.joinerName    || '',
    joinerAvatar:  msg.joinerAvatar  || '',
    creatorWon:    msg.creatorWon,
    flip:          msg.flip
  });
  if(cfHistory.length > 50) cfHistory = cfHistory.slice(0,50);
}
function openCFHistory() {
  var list = document.getElementById('cfHistoryModalList');
  if(!list) return;
  if(!cfHistory.length){
    list.innerHTML='<p style="color:rgba(168,85,247,0.4);font-size:13px;padding:12px 0;">No flips yet.</p>';
  } else {
    list.innerHTML='';
    cfHistory.forEach(function(h){
      var winner       = h.creatorWon ? h.creatorName   : h.joinerName;
      var loser        = h.creatorWon ? h.joinerName    : h.creatorName;
      var winnerAvatar = h.creatorWon ? h.creatorAvatar : h.joinerAvatar;
      var loserAvatar  = h.creatorWon ? h.joinerAvatar  : h.creatorAvatar;
      var row = document.createElement('div'); row.className='cf-hist-row';
      row.innerHTML=
        '<div class="cf-hist-avatars">'+
          '<img class="cf-hist-avatar" src="'+(winnerAvatar||'')+'" alt=""/>'+
          '<img class="cf-hist-avatar loser" src="'+(loserAvatar||'')+'" alt=""/>'+
        '</div>'+
        '<div class="cf-hist-names">'+
          '<span class="cf-hist-winner">🏆 '+(winner||'?')+'</span>'+
          '<span class="cf-hist-loser">'+(loser||'?')+'</span>'+
        '</div>'+
        '<span class="cf-hist-badge '+(h.flip||'')+'">'+(h.flip?h.flip.charAt(0).toUpperCase()+h.flip.slice(1):'')+'</span>';
      list.appendChild(row);
    });
  }
  document.getElementById('cfHistoryModal').style.display='flex';
}
function closeCFHistory() { document.getElementById('cfHistoryModal').style.display='none'; }

function onCFResult(msg) {
  // Track history
  addCFHistory(msg);
  if(currentUser){
    var isC=String(currentUser.id)===String(msg.creatorId);
    var isJ=String(currentUser.id)===String(msg.joinerId);
    if(isC||isJ){
      currentUser.flips++; currentUser.totalBet+=10;
      var won=(isC&&msg.creatorWon)||(isJ&&!msg.creatorWon);
      if(won){currentUser.wins++;currentUser.profit+=10;}else{currentUser.losses++;currentUser.profit-=10;}
      saveSession();
    }
  }
  coinflips=msg.coinflips||[]; renderCF();
  if(activeBattleId!==msg.id) return;

  setTimeout(function(){
    // Land coin on correct face
    coin.className='cf-coin '+(msg.flip==='heads'?'land-heads':'land-tails');

    document.getElementById('cfBattleRightPlaceholder').style.display='none';
    var ra=document.getElementById('cfBattleRightAvatar'); ra.src=msg.joinerAvatar||''; ra.style.display='block';
    document.getElementById('cfBattleRightName').textContent=msg.joinerName;
    var oppSide=msg.flip==='heads'?'tails':'heads';
    document.getElementById('cfBattleRightSide').textContent=cap(msg.creatorWon?oppSide:msg.flip);
    document.getElementById('cfBattleLeft').classList.add('highlight');
    document.getElementById('cfBattleRight').classList.add('highlight');

    var la=document.getElementById('cfBattleLeftAvatar'); var ra2=document.getElementById('cfBattleRightAvatar');
    if(msg.creatorWon){la.style.borderColor='#4ade80';la.style.boxShadow='0 0 18px rgba(74,222,128,0.7)';ra2.style.borderColor='#f87171';ra2.style.boxShadow='0 0 18px rgba(248,113,113,0.7)';}
    else{la.style.borderColor='#f87171';la.style.boxShadow='0 0 18px rgba(248,113,113,0.7)';ra2.style.borderColor='#4ade80';ra2.style.boxShadow='0 0 18px rgba(74,222,128,0.7)';}

    var isC2=currentUser&&String(currentUser.id)===String(msg.creatorId);
    var isJ2=currentUser&&String(currentUser.id)===String(msg.joinerId);
    var rEl=document.getElementById('cfBattleResult'); var rTx=document.getElementById('cfBattleResultText');
    rEl.style.display='flex';
    if(isC2||isJ2){
      var iWon=(isC2&&msg.creatorWon)||(isJ2&&!msg.creatorWon);
      rTx.textContent=iWon?'🏆 You Win!':'💀 You Lose';
      rTx.style.color=iWon?'#4ade80':'#f87171';
      
      
    } else {
      rTx.textContent='🪙 '+cap(msg.flip)+(msg.creatorWon?' — Creator Wins':' — Joiner Wins');
      rTx.style.color='#d8b4fe';
    }

    // Show provably fair reveal
    if(msg.fairness){
      document.getElementById('cfRevealSeed').textContent=msg.fairness.serverSeed;
      document.getElementById('cfRevealClient').textContent=msg.fairness.clientSeed;
      document.getElementById('cfRevealNonce').textContent=msg.fairness.nonce;
      document.getElementById('cfFairReveal').style.display='flex';
      document.getElementById('cfFairRow').style.display='none';
    }

    setTimeout(closeCFBattle,4000);
  },2000);
}

// ===== CHAT =====
var _lastChatMs=0; var _lastChatText='';
function sendChat() {
  if(!currentUser) return;
  var input=document.getElementById('chatInput'); var text=(input.value||'').trim().slice(0,200);
  if(!text) return;
  var now=Date.now();
  if(now-_lastChatMs<5000){ chatFlash('Slow down — 5 second cooldown.'); return; }
  if(text===_lastChatText){ chatFlash('Do not repeat the same message.'); return; }
  _lastChatMs=now; _lastChatText=text; input.value='';
  wsSend({type:'chat',userId:currentUser.id,username:currentUser.username,avatar:currentUser.avatar||'',text:text});
}

function addChat(entry) {
  ['chatMessages','chatMessagesCF'].forEach(function(cid){
    var box=document.getElementById(cid); if(!box) return;
    var empty=box.querySelector('.chat-empty'); if(empty)empty.remove();
    var role=entry.role||'user';
    var badge=role==='owner'?'<span class="owner-badge">OWNER</span>':role==='admin'?'<span class="admin-badge">ADMIN</span>':'';
    var nClass='chat-msg-name'+(role==='owner'?' owner-color':role==='admin'?' admin-color':'');
    var name=(entry.username||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    var text=(entry.text||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    var av=entry.avatar||''; var uid=entry.userId||'';
    var d=document.createElement('div'); d.className='chat-msg';
    d.innerHTML='<img class="chat-msg-avatar" src="'+av+'" alt="" onmouseover="hoverAv(this,true)" onmouseout="hoverAv(this,false)" onclick="showPlayerPopup(\''+esc(name)+'\',\''+esc(av)+'\',0,0,0,0,0,\''+esc(uid)+'\')" />'+
      '<div class="chat-msg-body"><span class="'+nClass+'" onmouseover="this.style.fontWeight=\'900\';this.style.textDecoration=\'underline\';" onmouseout="this.style.fontWeight=\'\';this.style.textDecoration=\'\';" onclick="showPlayerPopup(\''+esc(name)+'\',\''+esc(av)+'\',0,0,0,0,0,\''+esc(uid)+'\')">'+name+badge+'</span><div class="chat-msg-text">'+text+'</div></div>';
    box.appendChild(d); box.scrollTop=box.scrollHeight;
  });
}

function hoverAv(img,on) { var b=img.nextElementSibling; if(!b) return; var n=b.querySelector('.chat-msg-name'); if(!n) return; n.style.fontWeight=on?'900':''; n.style.textDecoration=on?'underline':''; }
function chatFlash(msg) {
  var i=document.getElementById('chatInput'); if(!i) return;
  i.style.borderColor='rgba(239,68,68,0.6)'; i.placeholder=msg;
  setTimeout(function(){i.style.borderColor='';i.placeholder='Message...';},3000);
}
function setOnline(n) {
  ['onlineCount','onlineCountCF'].forEach(function(id){ var el=document.getElementById(id); if(el) el.textContent=n+' online'; });
}

// ===== BANNERS =====
function showBanner(role,name,text) {
  var notif=document.getElementById('siteNotif'); if(!notif) return;
  var sender=document.getElementById('siteNotifSender');
  sender.className='site-notif-sender '+role; sender.textContent='['+(role==='owner'?'OWNER':'ADMIN')+'] '+name+':';
  notif.style.background=''; notif.style.borderColor='';
  document.getElementById('siteNotifText').textContent=' '+text; notif.style.display='flex';
}
function dismissNotif() { var n=document.getElementById('siteNotif'); if(n) n.style.display='none'; }
function showModBanner(action,duration,reason) {
  var notif=document.getElementById('siteNotif'); if(!notif) return;
  var sender=document.getElementById('siteNotifSender');
  notif.style.background=action==='ban'?'linear-gradient(135deg,rgba(220,38,38,0.95),rgba(185,28,28,0.9))':'linear-gradient(135deg,rgba(180,83,9,0.95),rgba(146,64,14,0.9))';
  notif.style.borderColor=action==='ban'?'rgba(239,68,68,0.6)':'rgba(251,191,36,0.6)';
  sender.className='site-notif-sender owner'; sender.textContent=action==='ban'?'🚫 BANNED':'🔇 MUTED';
  var durText=duration==='perm'?'permanently':'for '+duration;
  var txt=' You have been '+(action==='ban'?'banned':'muted')+' '+durText;
  if(action==='ban'&&reason) txt+=' — Reason: '+reason;
  document.getElementById('siteNotifText').textContent=txt; notif.style.display='flex';
}
function refreshMuteEmoji() {
  if(!currentUser) return;
  var nu=document.getElementById('navUsername'); if(nu) nu.textContent=currentUser.username+(currentUser.isMuted?' 🔇':'');
}

// ===== PROFILE MODAL =====
function openProfileModal() {
  if(!currentUser) return;
  var role=myRole();
  document.getElementById('pmAvatar').src=currentUser.avatar||'';
  document.getElementById('pmUsername').textContent=currentUser.username+(currentUser.isMuted?' 🔇':'');
  var rEl=document.getElementById('pmRole'); rEl.textContent=role==='owner'?'👑 Owner':role==='admin'?'⭐ Admin':''; rEl.className='pm-role'+(role!=='user'?' '+role:'');
  document.getElementById('pmTotalVal').textContent=currentUser.totalBet||0;
  document.getElementById('pmWins').textContent=currentUser.wins||0;
  document.getElementById('pmLosses').textContent=currentUser.losses||0;
  document.getElementById('pmFlips').textContent=currentUser.flips||0;
  var p=currentUser.profit||0; var pe=document.getElementById('pmProfit'); pe.textContent=p; pe.className='pm-stat-val '+(p>=0?'green':'red');
  var adminTab=document.getElementById('pmAdminTabBtn'); var maintCard=document.getElementById('maintCard');
  if(iAmAdmin()){ if(adminTab)adminTab.style.display='inline-block'; if(maintCard&&iAmOwner())maintCard.style.display='block'; }
  else { if(adminTab)adminTab.style.display='none'; if(maintCard)maintCard.style.display='none'; }
  pmSwitchTab('stats',document.querySelectorAll('.pm-tab')[0]);
  document.getElementById('profileModal').style.display='flex';
}
function closeProfileModal()         { document.getElementById('profileModal').style.display='none'; }
function closeProfileModalOutside(e) { if(e.target===document.getElementById('profileModal')) closeProfileModal(); }
function pmSwitchTab(name,btn) {
  ['pmStats','pmInventory','pmAdmin'].forEach(function(id){ document.getElementById(id).style.display='none'; });
  document.querySelectorAll('.pm-tab').forEach(function(b){ b.classList.remove('active'); });
  var el=document.getElementById('pm'+name.charAt(0).toUpperCase()+name.slice(1)); if(el)el.style.display='flex';
  if(btn)btn.classList.add('active');
}

// ===== ADMIN =====
function selectDuration(btn,d) {
  selectedDuration=d;
  document.querySelectorAll('.dur-btn').forEach(function(b){b.classList.remove('active');}); btn.classList.add('active');
}
function adminAction(action) {
  var input=document.getElementById('adminTargetUser').value.trim();
  var reasonEl=document.getElementById('adminReason'); var reason=reasonEl?reasonEl.value.trim():'';
  var msgEl=document.getElementById('adminActionMsg');
  if(!input){ msgEl.textContent='Enter a Roblox username.'; msgEl.style.color='#f87171'; msgEl.style.background='rgba(239,68,68,0.08)'; msgEl.style.display='block'; return; }
  if(action==='ban'&&!reason){ msgEl.textContent='A reason is required to ban.'; msgEl.style.color='#f87171'; msgEl.style.background='rgba(239,68,68,0.08)'; msgEl.style.display='block'; return; }
  if(!iAmAdmin()) return;
  msgEl.textContent='Looking up "'+input+'"...'; msgEl.style.color='#a78bfa'; msgEl.style.background='rgba(167,139,250,0.08)'; msgEl.style.display='block';
  fetch('/api/lookup-id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:input})})
    .then(function(r){return r.json();}).then(function(data){
      if(data.error){ msgEl.textContent='User "'+input+'" not found.'; msgEl.style.color='#f87171'; msgEl.style.background='rgba(239,68,68,0.08)'; return; }
      wsSend({type:action,userId:currentUser.id,username:currentUser.username,targetId:data.id,targetUsername:data.username,duration:selectedDuration,reason:reason||''});
      var lbl=selectedDuration==='perm'?'permanently':'for '+selectedDuration;
      msgEl.textContent=(action==='ban'?'🚫 Banned ':'🔇 Muted ')+data.username+' '+lbl+(reason?' — '+reason:'');
      msgEl.style.color=action==='ban'?'#f87171':'#fbbf24'; msgEl.style.background=action==='ban'?'rgba(239,68,68,0.08)':'rgba(234,179,8,0.08)';
      document.getElementById('adminTargetUser').value=''; if(reasonEl)reasonEl.value='';
    }).catch(function(){ msgEl.textContent='Network error.'; msgEl.style.color='#f87171'; });
}
function sendSiteNotif() {
  var text=document.getElementById('adminNotifInput').value.trim(); if(!text||!iAmAdmin()) return;
  wsSend({type:'announce',userId:currentUser.id,username:currentUser.username,text:text});
  document.getElementById('adminNotifInput').value='';
}

// ===== MOD LOG =====
function openModLog() {
  closeProfileModal();
  var list=document.getElementById('modLogList');
  list.innerHTML='<div class="cf-skeleton"></div><div class="cf-skeleton"></div>';
  document.getElementById('modLogModal').style.display='flex';
  fetch('/api/modlog?uid='+currentUser.id).then(function(r){return r.json();}).then(function(data){
    if(!data.length){ list.innerHTML='<p style="color:rgba(168,85,247,0.4);font-size:13px;padding:12px;">No mod actions yet.</p>'; return; }
    list.innerHTML='';
    data.forEach(function(e){
      var row=document.createElement('div'); row.className='modlog-row';
      row.innerHTML='<span class="modlog-action '+e.action+'">'+e.action.toUpperCase()+'</span>'+
        '<span class="modlog-meta">'+e.targetName+' ('+e.targetId+') by '+e.by+(e.reason?' — '+e.reason:'')+(e.duration?' ['+e.duration+']':'')+'</span>'+
        '<span class="modlog-meta">'+new Date(e.time).toLocaleString()+'</span>'+
      list.appendChild(row);
    });
  }).catch(function(){ list.innerHTML='<p style="color:#f87171;font-size:13px;padding:12px;">Failed to load mod log.</p>'; });
}
function closeModLog() { document.getElementById('modLogModal').style.display='none'; }

// ===== LEADERBOARD =====
function openLeaderboard() {
  document.getElementById('leaderboardModal').style.display='flex';
  loadLeaderboard();
}
function closeLeaderboard() { document.getElementById('leaderboardModal').style.display='none'; }
function lbTab(tab,btn) {
  lbCurrentTab=tab;
  document.querySelectorAll('.lb-tab').forEach(function(b){b.classList.remove('active');}); btn.classList.add('active');
  loadLeaderboard();
}
function loadLeaderboard() {
  var list=document.getElementById('lbList');
  list.innerHTML='<div class="cf-skeleton"></div><div class="cf-skeleton"></div><div class="cf-skeleton"></div>';
  fetch('/api/leaderboard').then(function(r){return r.json();}).then(function(data){
    var rows=lbCurrentTab==='bet'?data.mostBet:lbCurrentTab==='profit'?data.mostProfit:data.mostStreak;
    if(!rows||!rows.length){ list.innerHTML='<p style="color:rgba(168,85,247,0.4);font-size:13px;padding:12px 0;">No data currently available.</p>'; return; }
    list.innerHTML='';
    rows.forEach(function(e,i){
      var rank=i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1);
      var rankClass=i===0?'gold':i===1?'silver':i===2?'bronze':'';
      var val=lbCurrentTab==='bet'?e.totalBet:lbCurrentTab==='profit'?e.profit:e.bestStreak+' streak';
      var row=document.createElement('div'); row.className='lb-row';
      row.innerHTML='<span class="lb-rank '+rankClass+'">'+rank+'</span>'+
        '<img class="lb-avatar" src="'+(e.avatar||'')+'" alt=""/>'+
        '<span class="lb-name">'+e.username+'</span>'+
        '<span class="lb-value">'+val+'</span>';
      list.appendChild(row);
    });
  }).catch(function(){ list.innerHTML='<p style="color:#f87171;font-size:13px;padding:12px;">Failed to load.</p>'; });
}

// ===== JACKPOT =====
var JP_COLORS=['#a855f7','#7c3aed','#c084fc','#6d28d9','#d8b4fe','#4f46e5','#e879f9','#8b5cf6'];
var jpTimerVal=120; var jpTimerInterval=null; var jpSpinning=false;

function renderJackpot(){
  var total=jackpots.reduce(function(s,e){return s+e.amount;},0);
  var pv=document.getElementById('jpPotValue'); if(pv) pv.textContent=total.toFixed(1);
  var info=document.getElementById('jpDonutInfo'); if(info) info.textContent=jackpots.length+' | '+(jpTimerInterval?jpTimerVal+'s':'120s');
  renderDonut();
  var pl=document.getElementById('jpPlayers'); if(!pl) return;
  if(!jackpots.length){ pl.innerHTML='<div class="cf-empty"><p>No players yet</p></div>'; return; }
  pl.innerHTML='';
  jackpots.forEach(function(e,i){
    var chance=total>0?Math.round((e.amount/total)*100):0;
    var row=document.createElement('div'); row.className='jp-player-row';
    row.innerHTML='<span class="jp-player-swatch" style="background:'+JP_COLORS[i%JP_COLORS.length]+'"></span>'+
      '<img class="jp-player-avatar" src="'+(e.avatar||'')+'" alt=""/>'+
      '<span class="jp-player-name">'+e.username+'</span>'+
      '<span class="jp-player-amount">'+e.amount+'</span>'+
      '<span class="jp-player-chance">'+chance+'%</span>';
    pl.appendChild(row);
  });
  var joinBtn=document.getElementById('jpJoinBtn');
  if(joinBtn&&currentUser&&jackpots.find(function(e){return e.userId===currentUser.id;})){
    joinBtn.disabled=true; joinBtn.textContent='JOINED';
  } else if(joinBtn){ joinBtn.disabled=false; joinBtn.textContent='JOIN'; }
  if(jackpots.length>=2&&!jpTimerInterval&&!jpSpinning) startJPTimer();
}

function renderDonut(pool,angle){
  var canvas=document.getElementById('jpCanvas'); if(!canvas) return;
  var ctx=canvas.getContext('2d'); var cx=200,cy=200,r=178,inner=110;
  ctx.clearRect(0,0,400,400);
  var src=pool||jackpots;
  if(!src.length){
    ctx.beginPath(); ctx.arc(cx,cy,(r+inner)/2,0,Math.PI*2);
    ctx.strokeStyle='#7c3aed'; ctx.lineWidth=r-inner;
    ctx.shadowColor='rgba(168,85,247,0.8)'; ctx.shadowBlur=36; ctx.stroke(); ctx.shadowBlur=0;
  } else {
    var total=src.reduce(function(s,e){return s+e.amount;},0);
    var s=angle!=null?angle:-Math.PI/2;
    src.forEach(function(e,i){
      var sw=(e.amount/total)*Math.PI*2;
      ctx.beginPath(); ctx.arc(cx,cy,(r+inner)/2,s,s+sw,false);
      ctx.strokeStyle=JP_COLORS[i%JP_COLORS.length]; ctx.lineWidth=r-inner-6;
      ctx.shadowColor=JP_COLORS[i%JP_COLORS.length]; ctx.shadowBlur=18;
      ctx.stroke(); ctx.shadowBlur=0; s+=sw;
    });
  }
  ctx.beginPath(); ctx.arc(cx,cy,inner,0,Math.PI*2);
  ctx.fillStyle='#0e0b14'; ctx.fill();
  // inner ring border
  ctx.beginPath(); ctx.arc(cx,cy,inner,0,Math.PI*2);
  ctx.strokeStyle='rgba(147,51,234,0.2)'; ctx.lineWidth=1.5; ctx.stroke();
}

function startJPTimer(){
  jpTimerVal=120;
  jpTimerInterval=setInterval(function(){
    jpTimerVal--;
    var info=document.getElementById('jpDonutInfo'); if(info) info.textContent=jackpots.length+' | '+jpTimerVal+'s';
    if(jpTimerVal<=0){ clearInterval(jpTimerInterval); jpTimerInterval=null; }
  },1000);
}

function joinJackpot(){
  if(!currentUser){ openModal(); return; }
  if(jackpots.find(function(e){return e.userId===currentUser.id;})) return;
  wsSend({type:'jp_join',userId:currentUser.id,username:currentUser.username,avatar:currentUser.avatar||'',amount:10});
}

function onJPResult(msg){
  if(jpTimerInterval){clearInterval(jpTimerInterval);jpTimerInterval=null;}
  jpSpinning=true;
  var pool=msg.pool; var startAngle=-Math.PI/2; var spins=7*Math.PI*2;
  var t0=null; var dur=3200;
  function anim(ts){
    if(!t0)t0=ts; var t=Math.min((ts-t0)/dur,1);
    var ease=1-Math.pow(1-t,4);
    renderDonut(pool,startAngle+spins*ease);
    if(t<1){requestAnimationFrame(anim);}
    else{
      jpSpinning=false; jackpots=[]; renderJackpot();
      var pl=document.getElementById('jpPlayers'); if(!pl)return;
      var div=document.createElement('div'); div.className='jp-result-overlay';
      div.innerHTML='<div class="jp-result-winner">🏆 '+msg.winner.username+' won!</div><div class="jp-result-sub">Pot: '+msg.totalPot+' coins</div>';
      pl.innerHTML=''; pl.appendChild(div);
      setTimeout(renderJackpot,5000);
    }
  }
  requestAnimationFrame(anim);
}


// ===== DEPOSIT =====
function openDepositModal()  { closeProfileModal(); document.getElementById('depositModal').style.display='flex'; }
function closeDepositModal() { document.getElementById('depositModal').style.display='none'; }

// ===== PLAYER POPUP =====
function showPlayerPopup(username,avatar,wins,losses,flips,totalBet,profit,userId) {
  document.getElementById('ppAvatar').src=avatar;
  document.getElementById('ppUsername').textContent=username;
  document.getElementById('ppWins').textContent=wins;
  document.getElementById('ppLosses').textContent=losses;
  document.getElementById('ppFlips').textContent=flips;
  document.getElementById('ppVal').textContent=totalBet;
  var pe=document.getElementById('ppProfit'); pe.textContent=profit; pe.className=profit>=0?'green':'red';
  var role=getUserRole(userId); var badge=document.getElementById('ppRoleBadge');
  if(role!=='user'){badge.textContent=role.toUpperCase();badge.className='pp-role-badge '+role;badge.style.display='inline-block';}
  else badge.style.display='none';
  document.getElementById('playerPopup').style.display='flex';
}
function closePlayerPopup(e)      { if(e.target===document.getElementById('playerPopup')) closePlayerPopupDirect(); }
function closePlayerPopupDirect() { document.getElementById('playerPopup').style.display='none'; }

// ===== LOGOUT =====
function doLogout() {
  clearSession(); currentUser=null; coinflips=[]; jackpots=[];
  closeProfileModal(); document.getElementById('coinflipPage').style.display='none'; goToLanding();
}
