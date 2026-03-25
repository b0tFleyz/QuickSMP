// ═══════════════════════════════════════════════════════════
//  CONFIG  —  změň API_BASE na IP/URL svého serveru
// ═══════════════════════════════════════════════════════════
const API_BASE = "https://quicksmp-api.fleyz.workers.dev";

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
const state = {
  leaderboard    : [],
  prevLeaderboard: [],
  prevTop1Uuid   : null,
  killfeed       : [],
  server         : null,
  awards         : null,
  sortCol        : 'rank',
  sortAsc        : true,
  initialized    : false,
};

// ═══════════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════════
const DAY_INFO = [
  { name:'THE START',          desc:'PvP je vypnuté — hráči sbírají výbavu' },
  { name:'KILLING BEGINS',     desc:'PvP zapnuto — lov začíná!' },
  { name:'THE OVERKILLER',     desc:'Mace crafting je nyní dostupný' },
  { name:"THE END?",           desc:'End portál se otevírá' },
  { name:'BLOOD MOON',         desc:'2× body za kills a deaths!' },
  { name:'THE FINAL WAR',      desc:'Border se zmenšuje na 1000×1000' },
  { name:'THE FINAL JUDGMENT', desc:'Top 10 bojuje o korunu — zbytek spectate' },
];

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s <  10) return 'právě teď';
  if (s <  60) return `před ${s}s`;
  const m = Math.floor(s / 60);
  if (m <  60) return `před ${m}m`;
  const h = Math.floor(m / 60);
  if (h <  24) return `před ${h}h`;
  return `před ${Math.floor(h/24)}d`;
}

function skinAvatar(uuid, size=64) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(uuid)}/${size}`;
}
function skinBody(uuid) {
  return `https://mc-heads.net/body/${encodeURIComponent(uuid)}/100`;
}
const FALLBACK_AVATAR = 'https://minotar.net/helm/MHF_Steve/64';
const FALLBACK_BODY   = 'https://minotar.net/body/MHF_Steve/100';

const SKIN_FALLBACKS = {
  avatar: [
    uuid => `https://crafatar.com/avatars/${uuid}?size=64&overlay`,
    uuid => `https://minotar.net/helm/${uuid}/64`,
    ()   => FALLBACK_AVATAR,
  ],
  body: [
    uuid => `https://crafatar.com/renders/body/${uuid}?overlay`,
    uuid => `https://minotar.net/body/${uuid}/100`,
    ()   => FALLBACK_BODY,
  ],
};

function imgErr(el, type='avatar') {
  el.onerror = null;
  const uuid = el.dataset.uuid || '';
  const chain = SKIN_FALLBACKS[type] || SKIN_FALLBACKS.avatar;
  const tried = parseInt(el.dataset.fallback || '0', 10);
  if (tried < chain.length) {
    el.dataset.fallback = tried + 1;
    el.onerror = () => imgErr(el, type);
    el.src = chain[tried](uuid);
  } else {
    el.src = type === 'body' ? FALLBACK_BODY : FALLBACK_AVATAR;
  }
}

// animate number count-up/down
function animNum(el, from, to, dur=600) {
  if (from === to || !el) return;
  const start = performance.now();
  const diff = to - from;
  function step(now) {
    const p = Math.min((now - start) / dur, 1);
    const e = p < .5 ? 2*p*p : 1 - Math.pow(-2*p+2,2)/2;
    el.textContent = Math.round(from + diff * e);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = to;
  }
  requestAnimationFrame(step);
}

// ═══════════════════════════════════════════════════════════
//  OFFLINE BADGE
// ═══════════════════════════════════════════════════════════
let offlineTimer = null;
function showOffline() {
  document.getElementById('offline-badge').classList.add('show');
  clearTimeout(offlineTimer);
  offlineTimer = setTimeout(hideOffline, 20000);
}
function hideOffline() {
  document.getElementById('offline-badge').classList.remove('show');
}

// ═══════════════════════════════════════════════════════════
//  API LAYER
// ═══════════════════════════════════════════════════════════
async function apiFetch(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(API_BASE + path, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function apiGet(path) {
  try {
    const d = await apiFetch(path);
    if (d && d.success) { hideOffline(); return d; }
  } catch (_) { showOffline(); }
  return null;
}

// ═══════════════════════════════════════════════════════════
//  RENDER — HERO
// ═══════════════════════════════════════════════════════════
function renderHero(server) {
  if (!server) return;
  const day  = Math.max(1, Math.min(7, server.day || 1));
  const info = DAY_INFO[day - 1] || {};

  document.getElementById('hero-day-num').textContent  = `DEN ${day}`;
  document.getElementById('hero-day-name').textContent = server.dayName || info.name || '';
  document.getElementById('hero-day-desc').textContent = server.dayDescription || info.desc || '';
  document.getElementById('stat-online').textContent   = `${server.onlineCount||0}/${server.maxPlayers||100}`;
  const tpsEl = document.getElementById('stat-tps');
  if (tpsEl) tpsEl.textContent = `${server.pointMultiplier||1}×`;

  // lastUpdated staleness check
  if (server.lastUpdated) {
    const ageMs = Date.now() - new Date(server.lastUpdated).getTime();
    const staleEl = document.getElementById('stale-warning');
    if (staleEl) staleEl.style.display = ageMs > 120000 ? 'flex' : 'none';
  }

  // Nav live count
  const nl = document.getElementById('nav-live');
  nl.innerHTML = `<span class="live-dot"></span><span>${server.onlineCount||0}/${server.maxPlayers||100}</span>`;

  // Day progress bar
  let html = '';
  for (let i = 1; i <= 7; i++) {
    const cls = i < day ? 'past' : i === day ? 'active' : '';
    html += `<div class="day-step ${cls}">
      <div class="day-step-dot">${i}</div>
      <div class="day-step-label">${esc(DAY_INFO[i-1].name)}</div>
    </div>`;
    if (i < 7) html += `<div class="day-line ${i < day ? 'lit' : ''}"></div>`;
  }
  document.getElementById('day-progress').innerHTML = html;

  // Blood moon / finale
  const banner = document.getElementById('special-banner');
  if (server.bloodMoon) {
    document.body.classList.add('bloodmoon');
    banner.className = 'bloodmoon-banner';
    banner.style.display = 'flex';
    banner.textContent = 'BLOOD MOON AKTIVNÍ — 2× BODY ZA KILLS A DEATHS!';
  } else if (server.finale) {
    document.body.classList.remove('bloodmoon');
    banner.className = 'finale-banner';
    banner.style.display = 'flex';
    banner.textContent = '👑 FINALE — TOP 10 BOJUJE O KORUNU QUICKSMP!';
  } else {
    document.body.classList.remove('bloodmoon');
    banner.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════
//  RENDER — ABOUT / DAYS GRID (static, called once)
// ═══════════════════════════════════════════════════════════
function renderDaysGrid(currentDay) {
  const grid = document.getElementById('days-grid');
  if (!grid) return;
  const day = Math.max(1, Math.min(7, currentDay || 1));
  grid.innerHTML = DAY_INFO.map((d, i) => {
    const n = i + 1;
    const cls = n < day ? 'day-past' : n === day ? 'day-active' : '';
    const badge = n === day ? '<span class="day-card-badge">DNES</span>' : '';
    return `<div class="day-card ${cls}">
      ${badge}
      <div class="day-card-num">0${n}</div>
      <div class="day-card-name">${esc(d.name)}</div>
      <div class="day-card-desc">${esc(d.desc)}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
//  RENDER — LEADERBOARD
// ═══════════════════════════════════════════════════════════
function sortedPlayers(players) {
  const col = state.sortCol, asc = state.sortAsc;
  return [...players].sort((a, b) => {
    let va = a[col], vb = b[col];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va == null) va = -Infinity;
    if (vb == null) vb = -Infinity;
    return va < vb ? (asc?-1:1) : va > vb ? (asc?1:-1) : 0;
  });
}

function renderLeaderboard(players, eggHolder) {
  if (!players) return;
  const sorted = sortedPlayers(players);

  // Confetti on #1 change
  const newTop1 = sorted[0]?.uuid || null;
  if (state.initialized && state.prevTop1Uuid && state.prevTop1Uuid !== newTop1) {
    triggerConfetti();
  }
  state.prevTop1Uuid = newTop1;

  const tbody = document.getElementById('lb-body');

  // FLIP: snapshot old row tops
  const oldY = {};
  tbody.querySelectorAll('tr[data-uuid]').forEach(r => {
    oldY[r.dataset.uuid] = r.getBoundingClientRect().top;
  });

  // Build rows
  let html = '';
  sorted.forEach(p => {
    const isEgg  = eggHolder && eggHolder.uuid === p.uuid;
    const kd     = typeof p.kd === 'number' ? p.kd.toFixed(2)
                   : p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills + '.00';
    const avatar = esc(p.skin || skinAvatar(p.uuid));

    html += `<tr data-uuid="${esc(p.uuid)}" data-rank="${p.rank}" onclick="openModal('${esc(p.uuid)}')">
      <td><span class="rank-badge">#${p.rank}</span></td>
      <td>
        <div class="player-cell">
          <img class="player-avatar" src="${avatar}" alt="${esc(p.name)}" loading="lazy" data-uuid="${esc(p.uuid)}" onerror="imgErr(this)">
          <div>
            <div class="player-name-wrap">
              <span class="player-name">${esc(p.name)}</span>
              <span class="${p.online ? 'dot-online' : 'dot-offline'}" title="${p.online?'Online':'Offline'}"></span>
            </div>
            <div class="player-badge-row">
              ${p.hasBounty ? `<span class="badge badge-bounty">🎯 BOUNTY${p.bountyValue ? ' +'+p.bountyValue : ''}</span>` : ''}
              ${isEgg       ? `<span class="badge badge-egg">🥚 EGG</span>` : ''}
            </div>
          </div>
        </div>
      </td>
      <td class="c-score"><span data-anim="score" data-uuid="${esc(p.uuid)}">${p.score}</span></td>
      <td class="c-kills"><span data-anim="kills" data-uuid="${esc(p.uuid)}">${p.kills}</span></td>
      <td class="c-deaths"><span data-anim="deaths" data-uuid="${esc(p.uuid)}">${p.deaths}</span></td>
      <td class="c-kd">${kd}</td>
      <td class="c-streak">${p.killStreak}<span style="color:var(--text-muted);font-size:.78rem"> / ${p.bestKillStreak}</span></td>
      <td class="c-playtime">${esc(p.playtimeFormatted||'—')}</td>
    </tr>`;
  });

  tbody.innerHTML = html;

  // FLIP: animate position deltas
  tbody.querySelectorAll('tr[data-uuid]').forEach(r => {
    const uuid = r.dataset.uuid;
    if (oldY[uuid] != null) {
      const delta = oldY[uuid] - r.getBoundingClientRect().top;
      if (Math.abs(delta) > 1) {
        r.style.transition = 'none';
        r.style.transform = `translateY(${delta}px)`;
        void r.offsetHeight; // reflow
        r.style.transition = 'transform .42s cubic-bezier(.25,.46,.45,.94)';
        r.style.transform = '';
      }
    }
  });

  // Animate changed numbers
  sorted.forEach(p => {
    const prev = state.prevLeaderboard.find(q => q.uuid === p.uuid);
    if (!prev) return;
    ['score','kills','deaths'].forEach(field => {
      if (prev[field] !== p[field]) {
        const el = tbody.querySelector(`[data-anim="${field}"][data-uuid="${p.uuid}"]`);
        if (el) animNum(el, prev[field], p[field]);
      }
    });
  });

  state.prevLeaderboard = [...sorted];
}

// Table sort
document.querySelectorAll('#lb-table thead th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (state.sortCol === col) {
      state.sortAsc = !state.sortAsc;
    } else {
      state.sortCol = col;
      state.sortAsc = (col === 'rank' || col === 'name');
    }
    document.querySelectorAll('#lb-table thead th').forEach(h => h.classList.remove('sorted'));
    th.classList.add('sorted');
    const icon = th.querySelector('.sort-icon');
    if (icon) icon.textContent = state.sortAsc ? '↑' : '↓';
    renderLeaderboard(state.leaderboard, state.server?.dragonEggHolder);
  });
});

// ═══════════════════════════════════════════════════════════
//  RENDER — KILL FEED
// ═══════════════════════════════════════════════════════════
function renderKillfeed(kills, prevKills) {
  const list = document.getElementById('kf-list');
  if (!kills || kills.length === 0) {
    list.innerHTML = '<div class="kf-empty">👻 Zatím žádné útoky — klid před bouří…</div>';
    return;
  }

  const isFirst    = !prevKills || prevKills.length === 0;
  const prevTopTs  = isFirst ? 0 : (prevKills[0]?.timestamp || 0);
  const newEntries = kills.filter(k => k.timestamp > prevTopTs);

  if (isFirst) {
    list.innerHTML = kills.map(k => buildKE(k, false)).join('');
  } else if (newEntries.length > 0) {
    newEntries.slice().reverse().forEach(k => {
      const tmp = document.createElement('div');
      tmp.innerHTML = buildKE(k, true);
      list.insertBefore(tmp.firstElementChild, list.firstChild);
    });
    while (list.children.length > 20) list.removeChild(list.lastChild);
  }

  // Refresh relative timestamps
  list.querySelectorAll('[data-ts]').forEach(el => {
    el.textContent = relTime(+el.dataset.ts);
  });
}

function buildKE(k, isNew) {
  const bCls    = k.bountyKill ? ' bounty-kill' : '';
  const newCls  = isNew ? ' new' : '';
  const kAvatar = esc(k.killerSkin || skinAvatar(k.killerUuid||''));
  const vAvatar = esc(k.victimSkin || skinAvatar(k.victimUuid||''));
  return `<div class="kill-entry${bCls}${newCls}">
    <img class="kf-avatar" src="${kAvatar}" alt="${esc(k.killer)}" loading="lazy" data-uuid="${esc(k.killerUuid||'')}" onerror="imgErr(this)">
    <div class="kf-text">
      <span class="kf-killer">${esc(k.killer)}</span>
      <span class="kf-sword">⚔</span>
      <span class="kf-victim">${esc(k.victim)}</span>
      <img class="kf-avatar" src="${vAvatar}" alt="${esc(k.victim)}" loading="lazy" data-uuid="${esc(k.victimUuid||'')}" onerror="imgErr(this)">
      ${k.bountyKill ? '<span class="kf-btag">🎯 BOUNTY</span>' : ''}
    </div>
    <div class="kf-pts">
      ${k.pointsGained != null ? `<span class="kf-gain">+${k.pointsGained}</span>` : ''}
      ${k.pointsLost   != null ? `<span class="kf-lose">${k.pointsLost}</span>` : ''}
    </div>
    <span class="kf-time" data-ts="${k.timestamp}">${relTime(k.timestamp)}</span>
  </div>`;
}

// ═══════════════════════════════════════════════════════════
//  RENDER — AWARDS
// ═══════════════════════════════════════════════════════════
function renderAwards(awards) {
  const grid = document.getElementById('awards-grid');
  if (!awards || Object.keys(awards).length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:36px;text-align:center;color:var(--text-muted)">🏅 Ocenění nejsou momentálně dostupná</div>';
    return;
  }
  grid.innerHTML = Object.values(awards).map(a => {
    const avatar = esc(a.skin || skinAvatar(a.uuid||''));
    return `<div class="award-card" onclick="openModal('${esc(a.uuid)}')">
      <img class="award-avatar" src="${avatar}" alt="${esc(a.player)}" loading="lazy" data-uuid="${esc(a.uuid||'')}" onerror="imgErr(this)">
      <div class="award-meta">
        <div class="award-title">${esc(a.title)}</div>
        <div class="award-player">${esc(a.player)}</div>
        <div class="award-value">${esc(a.value)}</div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
//  RENDER — ONLINE PLAYERS
// ═══════════════════════════════════════════════════════════
function renderOnline(server) {
  const grid = document.getElementById('online-grid');
  if (!server?.onlinePlayers?.length) {
    grid.innerHTML = '<div class="online-empty">😴 Žádní hráči nejsou online</div>';
    document.getElementById('nav-live').innerHTML = '';
    return;
  }
  const egg = server.dragonEggHolder;
  grid.innerHTML = server.onlinePlayers.map(p => {
    const isEgg   = egg && egg.uuid === p.uuid;
    const avatar  = esc(p.skin || skinAvatar(p.uuid||''));
    const eggLine = isEgg ? '<br><span style="color:var(--egg);font-size:.7rem">🥚 EGG</span>' : '';
    return `<div class="online-card ${isEgg?'egg':''}" onclick="openModal('${esc(p.uuid)}')">
      <img class="oc-avatar" src="${avatar}" alt="${esc(p.name)}" loading="lazy" data-uuid="${esc(p.uuid||'')}" onerror="imgErr(this)">
      <div class="oc-name">${esc(p.name)}</div>
      <div class="oc-info">#${p.rank||'?'} &nbsp;·&nbsp; ${p.score} pt${eggLine}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
//  MODAL — PLAYER PROFILE
// ═══════════════════════════════════════════════════════════
function openModal(uuid) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  content.innerHTML = '<div class="spinner-center" style="padding:70px"><div class="spinner"></div></div>';

  apiGet(`/api/player/${encodeURIComponent(uuid)}`).then(data => {
    if (!data) {
      content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">❌ Hráč nenalezen</div>';
      return;
    }
    const p   = data.player;
    const kd  = typeof p.kd === 'number' ? p.kd.toFixed(2)
                : p.deaths > 0 ? (p.kills/p.deaths).toFixed(2) : p.kills+'.00';
    const bodyUrl = skinBody(p.uuid);

    content.innerHTML = `
      <div class="modal-header">
        <img class="modal-skin" src="${bodyUrl}" alt="${esc(p.name)}" loading="lazy" data-uuid="${esc(p.uuid)}" onerror="imgErr(this,'body')">
        <div class="modal-hdr-info">
          <div class="modal-name">${esc(p.name)}</div>
          <div class="modal-badge-row">
            <span class="${p.online ? 'mbadge-online' : 'mbadge-offline'}">${p.online ? '● Online' : '● Offline'}</span>
            ${p.hasBounty         ? '<span class="badge badge-bounty">🎯 BOUNTY</span>' : ''}
            ${p.isDragonEggHolder ? '<span class="badge badge-egg">🥚 EGG</span>' : ''}
          </div>
        </div>
      </div>
      <div class="modal-body">
        <div class="modal-stats-grid">
          <div class="mstat"><div class="mstat-label">Rank</div>      <div class="mstat-val c-gold">#${p.rank}</div></div>
          <div class="mstat"><div class="mstat-label">Score</div>     <div class="mstat-val c-gold">${p.score}</div></div>
          <div class="mstat"><div class="mstat-label">K/D Ratio</div> <div class="mstat-val">${kd}</div></div>
          <div class="mstat"><div class="mstat-label">Kills</div>     <div class="mstat-val c-green">${p.kills}</div></div>
          <div class="mstat"><div class="mstat-label">Deaths</div>    <div class="mstat-val c-red">${p.deaths}</div></div>
          <div class="mstat"><div class="mstat-label">Playtime</div>  <div class="mstat-val" style="font-size:1.05rem">${esc(p.playtimeFormatted||'—')}</div></div>
          <div class="mstat"><div class="mstat-label">Streak</div>    <div class="mstat-val c-orange">${p.killStreak}</div></div>
          <div class="mstat"><div class="mstat-label">Best Streak</div><div class="mstat-val c-orange">${p.bestKillStreak}</div></div>
        </div>
        <div class="modal-info-cards">
          ${p.hasBounty         ? `<div class="minfo-bounty">🎯 <strong>Bounty aktivní</strong> — odmění ${p.bountyValue||'?'}× bodů za zabití</div>` : ''}
          ${p.isDragonEggHolder ? `<div class="minfo-egg">🥚 <strong>Drží Dragon Egg</strong> — získává +1 bod za každý unikátní kill</div>` : ''}
        </div>
      </div>`;
  });
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ═══════════════════════════════════════════════════════════
//  PARTICLES
// ═══════════════════════════════════════════════════════════
(function () {
  const cvs = document.getElementById('particles-canvas');
  const ctx = cvs.getContext('2d');
  let W, H, pts;

  function resize() {
    W = cvs.width  = window.innerWidth;
    H = cvs.height = window.innerHeight;
  }

  function mkPt() {
    return {
      x : Math.random() * (W || 800),
      y : Math.random() * (H || 600),
      r : Math.random() * 1.4 + 0.3,
      vx: (Math.random() - .5) * .28,
      vy: -(Math.random() * .35 + .08),
      a : Math.random() * .45 + .1,
      c : Math.random() > .5 ? '255,215,0' : '180,180,220',
    };
  }

  function init() { resize(); pts = Array.from({length:60}, mkPt); }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    pts.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(${p.c},${p.a})`;
      ctx.fill();
      p.x += p.vx; p.y += p.vy;
      if (p.y < -4)    p.y = H + 4;
      if (p.x < -4)    p.x = W + 4;
      if (p.x > W + 4) p.x = -4;
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  init(); draw();
})();

// ═══════════════════════════════════════════════════════════
//  CONFETTI
// ═══════════════════════════════════════════════════════════
function triggerConfetti() {
  const cvs = document.getElementById('confetti-canvas');
  const ctx = cvs.getContext('2d');
  cvs.width  = window.innerWidth;
  cvs.height = window.innerHeight;

  const COLS = ['#FFD700','#FF8C00','#22c55e','#3b82f6','#a855f7','#ef4444','#fff'];
  const pcs  = Array.from({length:130}, () => ({
    x    : Math.random() * cvs.width,
    y    : -15,
    w    : Math.random() * 10 + 5,
    h    : Math.random() * 6 + 3,
    vx   : (Math.random() - .5) * 4.5,
    vy   : Math.random() * 4 + 2,
    rot  : Math.random() * 360,
    rotV : (Math.random() - .5) * 9,
    col  : COLS[Math.floor(Math.random() * COLS.length)],
    alpha: 1,
  }));

  let frame = 0;
  (function loop() {
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    let any = false;
    pcs.forEach(p => {
      if (p.alpha <= 0) return;
      any = true;
      p.x += p.vx; p.y += p.vy; p.vy += .12;
      p.rot += p.rotV;
      if (p.y > cvs.height * .65) p.alpha -= .018;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });
    if (any && ++frame < 220) requestAnimationFrame(loop);
    else ctx.clearRect(0, 0, cvs.width, cvs.height);
  })();
}

// ═══════════════════════════════════════════════════════════
//  MOBILE MENU
// ═══════════════════════════════════════════════════════════
function toggleMobileMenu() {
  document.getElementById('mobile-menu').classList.toggle('open');
  document.getElementById('hamburger').classList.toggle('open');
}
function closeMobileMenu() {
  document.getElementById('mobile-menu').classList.remove('open');
  document.getElementById('hamburger').classList.remove('open');
}

// ═══════════════════════════════════════════════════════════
//  REFRESH
// ═══════════════════════════════════════════════════════════
async function refreshMain() {
  const [lbR, srvR, awR] = await Promise.allSettled([
    apiGet('/api/leaderboard'),
    apiGet('/api/server'),
    apiGet('/api/awards'),
  ]);

  const lb  = lbR .status === 'fulfilled' ? lbR.value  : null;
  const srv = srvR.status === 'fulfilled' ? srvR.value : null;
  const aw  = awR .status === 'fulfilled' ? awR.value  : null;

  if (lb)  {
    state.leaderboard = lb.players || [];
    const totalKills = state.leaderboard.reduce((s,p) => s + (p.kills||0), 0);
    document.getElementById('stat-total').textContent = lb.totalPlayers ?? state.leaderboard.length;
    const killsEl = document.getElementById('stat-kills');
    if (killsEl) killsEl.textContent = totalKills;
    renderLeaderboard(state.leaderboard, srv?.dragonEggHolder);
  }
  if (srv) { state.server = srv; renderHero(srv); renderOnline(srv); renderDaysGrid(srv.day); }
  if (aw)  { state.awards = aw.awards; renderAwards(state.awards); }
}

async function refreshKF() {
  const d = await apiGet('/api/killfeed?limit=20');
  if (d) {
    const kills = d.kills || [];
    renderKillfeed(kills, state.killfeed);
    state.killfeed = kills;
  }
}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
async function initApp() {
  const [lbR, srvR, awR, kfR] = await Promise.allSettled([
    apiGet('/api/leaderboard'),
    apiGet('/api/server'),
    apiGet('/api/awards'),
    apiGet('/api/killfeed?limit=20'),
  ]);

  const lb  = lbR .status === 'fulfilled' ? lbR.value  : null;
  const srv = srvR.status === 'fulfilled' ? srvR.value : null;
  const aw  = awR .status === 'fulfilled' ? awR.value  : null;
  const kf  = kfR .status === 'fulfilled' ? kfR.value  : null;

  // Server / Hero
  if (srv) {
    state.server = srv;
    renderHero(srv);
    renderOnline(srv);
    renderDaysGrid(srv.day);
  } else {
    document.getElementById('hero-day-name').textContent = 'Server offline';
    document.getElementById('hero-day-desc').textContent = 'Čekám na připojení — stránka se automaticky obnoví.';
    document.getElementById('nav-live').innerHTML = '';
    renderDaysGrid(1);
    showOffline();
  }

  // Leaderboard
  if (lb) {
    state.leaderboard      = lb.players || [];
    state.prevLeaderboard  = [...state.leaderboard];
    state.prevTop1Uuid     = state.leaderboard[0]?.uuid || null;
    const totalKills = state.leaderboard.reduce((s,p) => s + (p.kills||0), 0);
    document.getElementById('stat-total').textContent = lb.totalPlayers ?? state.leaderboard.length;
    const killsEl = document.getElementById('stat-kills');
    if (killsEl) killsEl.textContent = totalKills;
    renderLeaderboard(state.leaderboard, srv?.dragonEggHolder);
  } else {
    document.getElementById('lb-body').innerHTML =
      `<tr><td colspan="8" class="lb-empty">🔌 Žebříček není dostupný — server je offline</td></tr>`;
  }

  // Kill feed
  if (kf) {
    state.killfeed = kf.kills || [];
    renderKillfeed(state.killfeed, []);
  } else {
    document.getElementById('kf-list').innerHTML = '<div class="kf-empty">🔌 Kill feed není dostupný</div>';
  }

  // Awards
  if (aw) {
    state.awards = aw.awards;
    renderAwards(state.awards);
  } else {
    renderAwards(null);
  }

  state.initialized = true;

  // Refresh intervals
  setInterval(refreshMain, 10000);
  setInterval(refreshKF,    5000);

  // Update relative timestamps every 30s
  setInterval(() => {
    document.querySelectorAll('[data-ts]').forEach(el => {
      el.textContent = relTime(+el.dataset.ts);
    });
  }, 30000);
}

initApp();
