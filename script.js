/* =========================================================
   PODIUM — AI Debate Coach
   Single-file frontend controller.
   ========================================================= */

const Podium = {
  formats: null,
  fallacies: [],
  fallacyPatterns: [],
  config: {
    style: null,
    compositionMode: null,
    humanCount: 1,
    ldHumanSide: 'aff',
    roleAssignments: {}, // seatId -> { isHuman, name }
    motion: '',
    persona: 'standard',
    difficulty: 'intermediate',
    asianSpeechLength: 420,
    prepEnabled: true,
    practiceMode: false,
    aiVoiceEnabled: true,
  },
  round: null, // built when a debate starts — see buildRound()
  wizardStep: 1,
  timers: {}, // named interval/timeout handles
};

/* ---------------------------------------------------------
   Small DOM helpers
   --------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wordCount(str) {
  const trimmed = (str || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function switchView(name) {
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  $$('.tab').forEach((t) => {
    const match = t.dataset.view === name;
    t.classList.toggle('is-active', match);
    t.setAttribute('aria-selected', match ? 'true' : 'false');
  });
  if (name === 'guide') renderGuideView();
  if (name === 'history') renderHistoryView();
  if (name === 'dashboard') renderDashboardView();
  if (name === 'library') renderLibraryView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------------------------------------------------
   Toasts
   --------------------------------------------------------- */
function toast(message, type = '') {
  const stack = $('#toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : type === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i><span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 320);
  }, 3600);
}

/* ---------------------------------------------------------
   Generic modal + confirm helpers
   --------------------------------------------------------- */
function openModal(id) { $(`#${id}`).hidden = false; }
function closeModal(id) { $(`#${id}`).hidden = true; }

function confirmDialog(title, body) {
  return new Promise((resolve) => {
    $('#confirm-modal-title').textContent = title;
    $('#confirm-modal-body').textContent = body;
    openModal('confirm-modal');
    const ok = $('#confirm-modal-ok');
    const cancel = $('#confirm-modal-cancel');
    const cleanup = () => { ok.onclick = null; cancel.onclick = null; closeModal('confirm-modal'); };
    ok.onclick = () => { cleanup(); resolve(true); };
    cancel.onclick = () => { cleanup(); resolve(false); };
  });
}

/* ---------------------------------------------------------
   Full-screen branded loading overlay (boot, judging, critique)
   --------------------------------------------------------- */
function showLoading(title, subtitle) {
  $('#loading-overlay-title').textContent = title;
  $('#loading-overlay-subtitle').textContent = subtitle || '';
  $('#loading-overlay').hidden = false;
}
function hideLoading() { $('#loading-overlay').hidden = true; }

/* ---------------------------------------------------------
   Theme
   --------------------------------------------------------- */
function initTheme() {
  const saved = localStorage.getItem('podium_theme');
  const theme = saved || 'dark';
  document.body.dataset.theme = theme;
  $('#btn-theme').checked = theme === 'light';
  on($('#btn-theme'), 'change', (e) => {
    const t = e.target.checked ? 'light' : 'dark';
    document.body.dataset.theme = t;
    localStorage.setItem('podium_theme', t);
  });
}

/* ---------------------------------------------------------
   Text-to-speech (announcements / AI replies)
   --------------------------------------------------------- */
function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0;
  window.speechSynthesis.speak(u);
}

/* ---------------------------------------------------------
   Confetti (lightweight canvas particle burst — no external lib)
   --------------------------------------------------------- */
const Confetti = (() => {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  let particles = [];
  let running = false;
  const colors = ['#667eea', '#764ba2', '#f093fb', '#00d2ff', '#f6d365'];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function burst(count = 160) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 5,
        vy: Math.random() * 3 + 2,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * 10,
        life: 0,
      });
    }
    if (!running) { running = true; requestAnimationFrame(loop); }
  }

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.rot += p.vr; p.life++;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    });
    particles = particles.filter((p) => p.y < canvas.height + 40 && p.life < 480);
    if (particles.length) requestAnimationFrame(loop);
    else running = false;
  }

  return { burst };
})();

/* ---------------------------------------------------------
   Fallacy detector — fast local pattern matching (loaded once),
   with an optional deeper AI pass on send.
   --------------------------------------------------------- */
const FallacyDetector = (() => {
  let compiled = null;
  let meta = null;

  async function load() {
    if (compiled) return;
    const [patterns, fallacyList] = await Promise.all([
      fetch('/data/fallacyPatterns.json').then((r) => r.json()),
      fetch('/data/fallacies.json').then((r) => r.json()),
    ]);
    Podium.fallacies = fallacyList;
    Podium.fallacyPatterns = patterns;
    meta = Object.fromEntries(fallacyList.map((f) => [f.id, f]));
    compiled = patterns.map((p) => ({ id: p.id, regexes: p.patterns.map((src) => new RegExp(src, p.flags || 'i')) }));
  }

  function scan(text) {
    if (!compiled || !text || !text.trim()) return [];
    const hits = [];
    const seen = new Set();
    for (const entry of compiled) {
      for (const re of entry.regexes) {
        const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        let match;
        while ((match = g.exec(text)) !== null) {
          const key = `${entry.id}:${match.index}`;
          if (seen.has(key)) { if (match[0].length === 0) g.lastIndex++; continue; }
          seen.add(key);
          const m = meta[entry.id];
          hits.push({ id: entry.id, name: m ? m.name : entry.id, severity: m ? m.defaultSeverity : 'mild', fix: m ? m.fix : '', index: match.index, length: match[0].length, matchText: match[0] });
          if (match[0].length === 0) g.lastIndex++;
          break;
        }
      }
    }
    hits.sort((a, b) => a.index - b.index);
    return hits;
  }

  return { load, scan, meta: () => meta };
})();

function renderComposerHighlight(text, hits) {
  const highlightEl = $('#composer-highlight');
  if (!hits.length) { highlightEl.innerHTML = ''; return; }
  let out = '';
  let cursor = 0;
  hits.forEach((h) => {
    out += escapeHtml(text.slice(cursor, h.index));
    out += `<mark title="${escapeHtml(h.name)}">${escapeHtml(text.slice(h.index, h.index + h.length))}</mark>`;
    cursor = h.index + h.length;
  });
  out += escapeHtml(text.slice(cursor));
  highlightEl.innerHTML = out;
}

function renderLiveFallacyFlags(hits) {
  const wrap = $('#composer-live-flags');
  wrap.innerHTML = '';
  const uniq = [...new Map(hits.map((h) => [h.id, h])).values()];
  uniq.forEach((h) => {
    const chip = document.createElement('span');
    chip.className = `fallacy-chip ${h.severity === 'severe' ? 'severe' : ''}`;
    chip.textContent = h.name;
    chip.title = h.fix || '';
    wrap.appendChild(chip);
  });
}

function pushFallacyFeed(hits, speakerName) {
  if (!hits.length) return;
  const feed = $('#fallacy-feed-live');
  const empty = feed.querySelector('.empty-note');
  if (empty) empty.remove();
  hits.forEach((h) => {
    const card = document.createElement('div');
    card.className = 'fallacy-chip' + (h.severity === 'severe' ? ' severe' : '');
    card.style.display = 'flex';
    card.style.marginBottom = '4px';
    card.innerHTML = `<span>${escapeHtml(h.name)} — ${escapeHtml(speakerName)}</span>`;
    feed.prepend(card);
  });
}

/* ---------------------------------------------------------
   API layer
   --------------------------------------------------------- */
async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request to ${path} failed`);
  return data;
}

const Api = {
  formats: () => api('/api/formats'),
  randomMotion: () => api('/api/motions/random'),
  health: () => api('/api/health'),
  speech: (payload) => api('/api/speech', payload),
  poiQuestion: (payload) => api('/api/poi-question', payload),
  poiResponse: (payload) => api('/api/poi-response', payload),
  crossExQuestion: (payload) => api('/api/cross-ex-question', payload),
  crossExAnswer: (payload) => api('/api/cross-ex-answer', payload),
  suggest: (payload) => api('/api/suggest', payload),
  guideAsk: (payload) => api('/api/guide/ask', payload),
  analyzeFallacies: (payload) => api('/api/analyze-fallacies', payload),
  analyzeFrames: (payload) => api('/api/analyze-frames', payload),
  judge: (payload) => api('/api/judge', payload),
  critique: (payload) => api('/api/critique', payload),
  share: (payload) => api('/api/share', payload),
};

/* =========================================================
   SETUP WIZARD
   ========================================================= */
const STYLE_META = {
  bp: { icon: 'fa-users-rectangle', name: 'British Parliamentary', blurb: '4 teams · 8 speakers · 7-min speeches with POIs' },
  asian: { icon: 'fa-people-group', name: 'Asian Parliamentary', blurb: '2 teams · 6 speakers + reply speeches · POIs' },
  ld: { icon: 'fa-user-tie', name: 'Lincoln-Douglas', blurb: '1v1 · constructive, cross-ex, and rebuttals' },
};

const COMP_OPTIONS = {
  bp: [
    { id: 'all_human', icon: 'fa-user-group', name: 'All Human', desc: 'Everyone speaks — AI acts as moderator & judge only.' },
    { id: 'all_ai', icon: 'fa-robot', name: 'All AI (demo)', desc: 'Sit back and watch all 8 AI speakers debate.' },
    { id: 'mixed', icon: 'fa-people-arrows', name: 'Mixed', desc: 'Pick which seats are human — AI fills the rest.' },
  ],
  asian: [
    { id: 'all_human', icon: 'fa-user-group', name: 'All Human', desc: 'Everyone speaks — AI acts as moderator & judge only.' },
    { id: 'all_ai', icon: 'fa-robot', name: 'All AI (demo)', desc: 'Sit back and watch all 6 AI speakers debate.' },
    { id: 'mixed', icon: 'fa-people-arrows', name: 'Mixed', desc: 'Pick which seats are human — AI fills the rest.' },
  ],
  ld: [
    { id: 'h_vs_h', icon: 'fa-user-group', name: 'Human vs Human', desc: 'Pass-and-play — two humans debate, AI judges.' },
    { id: 'h_vs_ai', icon: 'fa-user-robot', name: 'Human vs AI', desc: 'You debate a configurable AI opponent.' },
    { id: 'ai_vs_ai', icon: 'fa-robot', name: 'AI vs AI', desc: 'Watch two AI debaters go head-to-head.' },
  ],
};

// Seat keys shown in the roster editor, in reading order, per style.
const SEAT_KEYS = {
  bp: ['PM', 'DPM', 'LO', 'DLO', 'MG', 'MO', 'GW', 'OW'],
  asian: ['PM', 'DPM', 'GW', 'LO', 'DLO', 'OW'],
  ld: ['aff', 'neg'],
};

function seatTeamInfo(style, seatKey) {
  const f = Podium.formats[style];
  if (style === 'ld') return f.teams.find((t) => t.id === seatKey);
  const order = f.speakingOrder.find((o) => o.role === seatKey);
  return f.teams.find((t) => t.id === order.team);
}

function seatRoleName(style, seatKey) {
  if (style === 'ld') return seatKey === 'aff' ? 'Affirmative' : 'Negative';
  return Podium.formats[style].roleNames[seatKey];
}

function renderStyleGrid() {
  const grid = $('#style-grid');
  grid.innerHTML = '';
  Object.entries(STYLE_META).forEach(([id, meta]) => {
    const card = document.createElement('div');
    card.className = 'style-card' + (Podium.config.style === id ? ' is-selected' : '');
    card.innerHTML = `<i class="fa-solid ${meta.icon}"></i><h4>${meta.name}</h4><p>${meta.blurb}</p>`;
    on(card, 'click', () => selectStyle(id));
    grid.appendChild(card);
  });
}

function selectStyle(id) {
  if (Podium.config.style !== id) {
    Podium.config.style = id;
    Podium.config.compositionMode = null;
    Podium.config.roleAssignments = {};
  }
  renderStyleGrid();
  $('#step1-next').disabled = false;
  $('#asian-length-group').hidden = id !== 'asian';
}

function renderCompositionGrid() {
  const grid = $('#composition-grid');
  grid.innerHTML = '';
  const opts = COMP_OPTIONS[Podium.config.style] || [];
  opts.forEach((opt) => {
    const card = document.createElement('div');
    card.className = 'comp-card' + (Podium.config.compositionMode === opt.id ? ' is-selected' : '');
    card.innerHTML = `<i class="fa-solid ${opt.icon}"></i><div><h4>${opt.name}</h4><p>${opt.desc}</p></div>`;
    on(card, 'click', () => selectComposition(opt.id));
    grid.appendChild(card);
  });

  if (Podium.config.style === 'ld' && Podium.config.compositionMode === 'h_vs_ai') {
    renderLdSideBanner();
  }
}

function renderLdSideBanner() {
  const group = $('#human-count-group');
  group.hidden = false;
  $('#human-count-group .field-label').textContent = 'Which side do you play?';
  const picker = $('#human-count-picker');
  picker.innerHTML = '';
  ['aff', 'neg'].forEach((side) => {
    const btn = document.createElement('button');
    btn.className = 'segment' + (Podium.config.ldHumanSide === side ? ' is-active' : '');
    btn.type = 'button';
    btn.textContent = side === 'aff' ? 'Affirmative' : 'Negative';
    on(btn, 'click', () => { Podium.config.ldHumanSide = side; renderCompositionGrid(); });
    picker.appendChild(btn);
  });
}

function renderHumanCountPicker() {
  const group = $('#human-count-group');
  const style = Podium.config.style;
  if (style === 'ld') return; // handled by renderLdSideBanner
  if (Podium.config.compositionMode !== 'mixed') { group.hidden = true; return; }
  group.hidden = false;
  $('#human-count-group .field-label').textContent = 'How many human speakers?';
  const total = SEAT_KEYS[style].length;
  const picker = $('#human-count-picker');
  picker.innerHTML = '';
  for (let n = 1; n <= total - 1; n++) {
    const btn = document.createElement('button');
    btn.className = 'segment' + (Podium.config.humanCount === n ? ' is-active' : '');
    btn.type = 'button';
    btn.textContent = String(n);
    on(btn, 'click', () => { Podium.config.humanCount = n; renderHumanCountPicker(); });
    picker.appendChild(btn);
  }
}

function selectComposition(id) {
  Podium.config.compositionMode = id;
  Podium.config.roleAssignments = {}; // reset — roster step will rebuild defaults
  renderCompositionGrid();
  renderHumanCountPicker();
  $('#step2-next').disabled = false;
}

function defaultRoleAssignments() {
  const style = Podium.config.style;
  const seats = SEAT_KEYS[style];
  const mode = Podium.config.compositionMode;
  const assignments = {};
  seats.forEach((seatKey, i) => {
    let isHuman;
    if (style === 'ld') {
      if (mode === 'h_vs_h') isHuman = true;
      else if (mode === 'ai_vs_ai') isHuman = false;
      else isHuman = seatKey === Podium.config.ldHumanSide; // h_vs_ai
    } else if (mode === 'all_human') isHuman = true;
    else if (mode === 'all_ai') isHuman = false;
    else isHuman = i < Podium.config.humanCount; // mixed default: first N seats

    const existing = Podium.config.roleAssignments[seatKey];
    assignments[seatKey] = existing || { isHuman, name: isHuman ? '' : aiNameFor(seatKey) };
    if (!existing) assignments[seatKey].isHuman = isHuman;
  });
  return assignments;
}

function aiNameFor(seatKey) {
  const pool = ['Atlas', 'Nova', 'Sable', 'Orion', 'Quill', 'Vega', 'Indigo', 'Cato'];
  const idx = Math.abs(seatKey.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % pool.length;
  return `AI ${pool[idx]}`;
}

function renderRosterEditor() {
  const style = Podium.config.style;
  const mode = Podium.config.compositionMode;
  Podium.config.roleAssignments = defaultRoleAssignments();
  const wrap = $('#roster-editor');
  wrap.innerHTML = '';
  const showToggle = mode === 'mixed';

  SEAT_KEYS[style].forEach((seatKey) => {
    const team = seatTeamInfo(style, seatKey);
    const roleName = seatRoleName(style, seatKey);
    const assign = Podium.config.roleAssignments[seatKey];
    const row = document.createElement('div');
    row.className = 'roster-row';
    row.dataset.seat = seatKey;
    row.innerHTML = `
      <span class="rr-role">${escapeHtml(roleName)}</span>
      <span class="rr-team">${escapeHtml(team.name)}</span>
      ${showToggle ? `<select class="text-input rr-toggle">
        <option value="human" ${assign.isHuman ? 'selected' : ''}>Human</option>
        <option value="ai" ${!assign.isHuman ? 'selected' : ''}>AI</option>
      </select>` : `<span class="rr-team">${assign.isHuman ? 'Human' : 'AI'}</span>`}
      <input class="text-input rr-name" type="text" maxlength="30" placeholder="${assign.isHuman ? 'Enter a name…' : 'AI persona name'}" value="${escapeHtml(assign.name)}" ${assign.isHuman ? '' : 'disabled'} />
    `;
    wrap.appendChild(row);

    const nameInput = row.querySelector('.rr-name');
    on(nameInput, 'input', () => { Podium.config.roleAssignments[seatKey].name = nameInput.value; });

    const toggle = row.querySelector('.rr-toggle');
    if (toggle) {
      on(toggle, 'change', () => {
        const isHuman = toggle.value === 'human';
        Podium.config.roleAssignments[seatKey].isHuman = isHuman;
        Podium.config.roleAssignments[seatKey].name = isHuman ? '' : aiNameFor(seatKey);
        nameInput.value = Podium.config.roleAssignments[seatKey].name;
        nameInput.disabled = !isHuman;
        nameInput.placeholder = isHuman ? 'Enter a name…' : 'AI persona name';
      });
    }
  });
}

function rosterIsValid() {
  return Object.values(Podium.config.roleAssignments).every((a) => a.name && a.name.trim().length);
}

function renderReviewSummary() {
  const c = Podium.config;
  const styleMeta = STYLE_META[c.style];
  const humanSeats = Object.entries(c.roleAssignments).filter(([, a]) => a.isHuman).length;
  const totalSeats = SEAT_KEYS[c.style].length;
  const rows = [
    ['Format', styleMeta.name],
    ['Lineup', (COMP_OPTIONS[c.style].find((o) => o.id === c.compositionMode) || {}).name || ''],
    ['Human seats', `${humanSeats} of ${totalSeats}`],
    ['Motion', c.motion || '(not set)'],
    ['AI persona', c.persona.charAt(0).toUpperCase() + c.persona.slice(1)],
    ['Difficulty', c.difficulty.charAt(0).toUpperCase() + c.difficulty.slice(1)],
    ['Prep time', c.prepEnabled ? '15 minutes' : 'Skipped'],
    ['AI voice', c.aiVoiceEnabled ? 'On — speeches read aloud' : 'Off — text only'],
    ['Practice mode', c.practiceMode ? 'On — AI suggestions available' : 'Off'],
  ];
  $('#review-summary').innerHTML = rows.map(([l, v]) => `<div class="review-row"><span class="rl">${escapeHtml(l)}</span><span class="rv">${escapeHtml(v)}</span></div>`).join('');
}

function goToWizardStep(n) {
  Podium.wizardStep = n;
  $$('.wizard-step').forEach((s) => s.classList.toggle('is-active', Number(s.dataset.step) === n));
  $$('.wp-dot').forEach((d) => {
    const step = Number(d.dataset.step);
    d.classList.toggle('is-active', step === n);
    d.classList.toggle('is-done', step < n);
  });
  if (n === 2) {
    renderCompositionGrid();
    renderHumanCountPicker();
    $('#step2-next').disabled = !Podium.config.compositionMode;
  }
  if (n === 3) renderRosterEditor();
  if (n === 5) renderReviewSummary();
}

function initWizard() {
  renderStyleGrid();
  on($('#step1-next'), 'click', () => goToWizardStep(2));
  on($('#step2-back'), 'click', () => goToWizardStep(1));
  on($('#step2-next'), 'click', () => goToWizardStep(3));
  on($('#step3-back'), 'click', () => goToWizardStep(2));
  on($('#step3-next'), 'click', () => {
    if (!rosterIsValid()) { toast('Give every human seat a name first.', 'warn'); return; }
    goToWizardStep(4);
  });
  on($('#step4-back'), 'click', () => goToWizardStep(3));
  on($('#step4-next'), 'click', () => goToWizardStep(5));
  on($('#step5-back'), 'click', () => goToWizardStep(4));

  on($('#input-motion'), 'input', (e) => {
    Podium.config.motion = e.target.value.trim();
    $('#step4-next').disabled = !Podium.config.motion;
  });
  on($('#btn-random-motion'), 'click', async () => {
    try {
      const { motion } = await Api.randomMotion();
      $('#input-motion').value = motion;
      Podium.config.motion = motion;
      $('#step4-next').disabled = false;
    } catch (err) { toast('Could not fetch a motion — check the server.', 'error'); }
  });
  on($('#persona-picker'), 'change', (e) => { Podium.config.persona = e.target.value; });
  $$('#difficulty-picker .segment').forEach((btn) => on(btn, 'click', () => {
    $$('#difficulty-picker .segment').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    Podium.config.difficulty = btn.dataset.value;
  }));
  $$('#asian-length-picker .segment').forEach((btn) => on(btn, 'click', () => {
    $$('#asian-length-picker .segment').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    Podium.config.asianSpeechLength = Number(btn.dataset.value);
  }));
  on($('#toggle-prep'), 'change', (e) => { Podium.config.prepEnabled = e.target.checked; });
  on($('#toggle-ai-voice'), 'change', (e) => { Podium.config.aiVoiceEnabled = e.target.checked; });
  on($('#toggle-practice'), 'change', (e) => { Podium.config.practiceMode = e.target.checked; });

  on($('#btn-start-debate'), 'click', startRound);
}

/* =========================================================
   ROUND CONSTRUCTION
   ========================================================= */
function buildRound() {
  const style = Podium.config.style;
  const f = Podium.formats[style];
  const assignments = Podium.config.roleAssignments;

  // Seats — the units that get scored (1 per roster row).
  const seats = SEAT_KEYS[style].map((seatKey) => {
    const team = seatTeamInfo(style, seatKey);
    const a = assignments[seatKey];
    return {
      id: seatKey,
      role: seatKey,
      roleName: seatRoleName(style, seatKey),
      team: team.id,
      teamName: team.name,
      side: team.side,
      isHuman: a.isHuman,
      name: a.name,
    };
  });
  const seatById = Object.fromEntries(seats.map((s) => [s.id, s]));

  // Turns — every entry in the format's speaking order, resolved to a seat.
  const turns = f.speakingOrder.map((entry, idx) => {
    let seatKey = entry.role;
    if (style === 'asian') {
      if (entry.role === 'PMR') seatKey = 'PM';
      if (entry.role === 'LOR') seatKey = 'LO';
    }
    if (style === 'ld') seatKey = entry.team; // aff / neg

    const seat = seatById[seatKey];
    const team = f.teams.find((t) => t.id === entry.team);
    let duration = entry.duration;
    if (style === 'asian' && entry.type === 'main') duration = Podium.config.asianSpeechLength;

    return {
      turnIndex: idx,
      seatId: seat.id,
      role: entry.role,
      roleLabel: entry.label || f.roleNames[entry.role] || entry.role,
      team: entry.team,
      teamName: team.name,
      side: team.side,
      type: entry.type,
      duration,
      warning: entry.warning,
      isHuman: seat.isHuman,
      speakerName: seat.name,
    };
  });

  return {
    style, formatDef: f, motion: Podium.config.motion, persona: Podium.config.persona,
    difficulty: Podium.config.difficulty, practiceMode: Podium.config.practiceMode,
    aiVoiceEnabled: Podium.config.aiVoiceEnabled,
    seats, turns, currentTurnIndex: 0, transcript: [],
    poiOfferedThisTurn: false, videoNotes: {}, videoBlobs: {},
    scores: null, critique: null, startedAt: Date.now(), id: randomId(),
  };
}

function startRound() {
  if (!Podium.config.motion) { toast('Set a motion before starting.', 'warn'); return; }
  Podium.round = buildRound();
  if (Podium.config.prepEnabled) {
    startPrepScreen();
  } else {
    enterDebateScreen();
  }
}

/* =========================================================
   PREP SCREEN
   ========================================================= */
function startPrepScreen() {
  showRawView('prep');
  $('#prep-motion-label').textContent = Podium.round.motion;
  let remaining = Podium.formats.prepSeconds || 900;
  const total = remaining;
  const ring = $('#prep-ring-progress');
  const circumference = 2 * Math.PI * 88;
  ring.style.strokeDasharray = String(circumference);

  function tick() {
    $('#prep-timer-display').textContent = formatTime(remaining);
    ring.style.strokeDashoffset = String(circumference * (1 - remaining / total));
    if (remaining <= 0) { clearInterval(Podium.timers.prep); enterDebateScreen(); return; }
    remaining--;
  }
  tick();
  clearInterval(Podium.timers.prep);
  Podium.timers.prep = setInterval(tick, 1000);

  $('#btn-skip-prep').onclick = () => { clearInterval(Podium.timers.prep); enterDebateScreen(); };
}

// switchView() only knows about tab-linked views; debate/prep/results/critique
// are reached programmatically, so we use a tiny wrapper that also clears tabs.
function showRawView(name) {
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  $$('.tab').forEach((t) => t.classList.remove('is-active'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =========================================================
   DEBATE SCREEN — core loop
   ========================================================= */
let currentTurnPois = [];
let currentTurnFrames = [];
let currentTurnElapsed = 0;
let speechStartedAt = 0;
let poiCountThisTurn = 0;
// Guarantees strict speaking-order integrity: a turn can only ever be
// finalized once, and the next turn's UI cannot render until the current
// one has been finalized — so e.g. DLO can never speak before DPM has
// actually completed (sent) their speech, even with a rapid double-click
// or an overlapping async video-stop.
let turnLocked = false;

function enterDebateScreen() {
  showRawView('debate');
  $('#debate-motion-label').textContent = Podium.round.motion;
  renderRosterSidebar();
  renderTeamScoresPlaceholder();
  startTurn();
}

function renderRosterSidebar() {
  const wrap = $('#live-roster');
  wrap.innerHTML = '';
  const seenSeats = new Set();
  Podium.round.turns.forEach((t) => seenSeats.add(t.seatId));
  Podium.round.seats.forEach((seat) => {
    const currentTurn = Podium.round.turns[Podium.round.currentTurnIndex];
    const isCurrent = currentTurn && currentTurn.seatId === seat.id;
    const isDone = Podium.round.transcript.some((e) => e.seatId === seat.id) && !isCurrent;
    const row = document.createElement('div');
    row.className = 'roster-item' + (isCurrent ? ' is-current' : '') + (isDone ? ' is-done' : '');
    row.innerHTML = `<span class="roster-item-role">${escapeHtml(seat.role)}</span><span class="roster-item-name">${escapeHtml(seat.name)}</span><span class="roster-item-badge">${seat.isHuman ? 'Human' : 'AI'}</span>`;
    wrap.appendChild(row);
  });
}

function renderTeamScoresPlaceholder() {
  const wrap = $('#team-scores');
  wrap.innerHTML = '';
  Podium.round.formatDef.teams.forEach((team) => {
    const row = document.createElement('div');
    row.className = 'team-score-row';
    row.innerHTML = `<div class="ts-label"><span>${escapeHtml(team.name)}</span><span>revealed after judging</span></div><div class="ts-track"><span class="ts-fill" style="width:0%"></span></div>`;
    wrap.appendChild(row);
  });
}

function currentTurn() { return Podium.round.turns[Podium.round.currentTurnIndex]; }

function startTurn() {
  turnLocked = false;
  currentTurnPois = [];
  currentTurnFrames = [];
  poiCountThisTurn = 0;
  renderRosterSidebar();
  const t = currentTurn();
  if (!t) { finishRound(); return; }

  $('#debate-meta-label').textContent = `Seat ${Podium.round.currentTurnIndex + 1} of ${Podium.round.turns.length} · ${Podium.round.formatDef.name}`;
  $('#speaker-banner-name').textContent = `${t.speakerName} — ${t.teamName}`;
  $('#speaker-banner-role').textContent = t.roleLabel;
  $('#speaker-banner-avatar').innerHTML = `<i class="fa-solid ${t.isHuman ? 'fa-user' : 'fa-robot'}"></i>`;
  $('#btn-announce-tts').onclick = () => speak(`Speaker ${t.speakerName} from ${t.teamName}, speaking as ${t.roleLabel}`);
  speak(`Speaker ${t.speakerName} from ${t.teamName}, speaking as ${t.roleLabel}`);

  $('#transcript-log').scrollTop = 0;
  $('#suggestion-panel').hidden = true;
  $('#btn-raise-poi').hidden = true;

  if (t.type === 'crossex') { runCrossExTurn(t); return; }

  if (t.isHuman) runHumanTurn(t); else runAiTurn(t);
}

function advanceTurn() {
  Podium.round.currentTurnIndex++;
  startTurn();
}

/* ---------- generic countdown ring ---------- */
function runCountdown({ duration, warning, ring, display, onTick, onComplete }) {
  const ringEl = $(ring);
  const displayEl = $(display);
  const progressEl = ringEl.querySelector('.ring-progress') || $(`${ring}-progress`);
  const circumference = 2 * Math.PI * 96;
  progressEl.style.strokeDasharray = String(circumference);
  let remaining = duration;
  clearInterval(Podium.timers.turn);

  function paint() {
    displayEl.textContent = formatTime(remaining);
    progressEl.style.strokeDashoffset = String(circumference * (1 - Math.max(0, remaining) / duration));
    ringEl.classList.toggle('is-warning', warning && remaining <= (duration - warning) && remaining > 30);
    ringEl.classList.toggle('is-danger', remaining <= 30 && remaining > 0);
    if (onTick) onTick(remaining);
  }
  paint();
  Podium.timers.turn = setInterval(() => {
    remaining--;
    paint();
    if (remaining <= 0) { clearInterval(Podium.timers.turn); if (onComplete) onComplete(); }
  }, 1000);

  return { stop: () => clearInterval(Podium.timers.turn), getRemaining: () => remaining };
}

/* ---------- human turn ---------- */
function runHumanTurn(t) {
  $('#composer').style.display = '';
  $('#ai-typing-indicator').hidden = true;
  $('#composer-input').value = '';
  $('#composer-input').disabled = false;
  $('#btn-send-speech').disabled = false;
  $('#composer-input').placeholder = `Deliver your ${t.roleLabel.toLowerCase()}…`;
  $('#word-count').textContent = '0 words';
  renderComposerHighlight('', []);
  $('#composer-live-flags').innerHTML = '';
  $('#timer-sub').textContent = 'speaking time — live';
  resetInputTabs();
  $('#btn-suggest').hidden = !Podium.round.practiceMode;
  $('#btn-mic').hidden = false;

  $('#btn-send-speech').onclick = () => submitHumanSpeech(t);

  speechStartedAt = Date.now();
  const poiWindow = Podium.round.formatDef.poi;
  runCountdown({
    duration: t.duration, warning: t.warning, ring: '#timer-ring', display: '#timer-display',
    onTick: (remaining) => {
      const elapsed = t.duration - remaining;
      currentTurnElapsed = elapsed;
      if (poiWindow.enabled && t.type === 'main' && elapsed >= poiWindow.windowStart && elapsed <= poiWindow.windowEnd) {
        $('#btn-raise-poi').hidden = false;
      } else {
        $('#btn-raise-poi').hidden = true;
      }
    },
    onComplete: () => {
      toast(`Time's up for ${t.speakerName} — wrap up and send.`, 'warn');
      $('#btn-raise-poi').hidden = true;
    },
  });

  $('#btn-raise-poi').onclick = () => openPoiFlow(t);
}

function resetInputTabs() {
  $$('.input-tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.mode === 'text'));
  $('#video-input-wrap').hidden = true;
  stopMic();
  stopVideoPreview();
}

function submitHumanSpeech(t) {
  if (turnLocked) return;
  const text = $('#composer-input').value.trim();
  if (!text) { toast('Write or record a speech before sending.', 'warn'); return; }
  $('#btn-send-speech').disabled = true;
  finalizeTurn(t, text);
}

/* ---------- AI turn ---------- */
async function runAiTurn(t) {
  $('#composer').style.display = 'none';
  $('#ai-typing-indicator').hidden = false;
  $('#ai-typing-label').textContent = `${t.speakerName} is composing a ${t.roleLabel.toLowerCase()}…`;
  $('#timer-sub').textContent = 'AI pace';
  $('#btn-raise-poi').hidden = Podium.round.formatDef.poi.enabled && t.type === 'main' ? false : true;

  let text = '';
  try {
    text = (await Api.speech({
      style: Podium.round.style, motion: Podium.round.motion, role: t.role, roleName: t.roleLabel,
      teamName: t.teamName, side: t.side, persona: Podium.round.persona, speechType: t.type,
      durationSeconds: t.duration, transcript: Podium.round.transcript, difficulty: Podium.round.difficulty,
    })).text;
  } catch (err) {
    toast('AI speech generation failed — check your Groq API key.', 'error');
    text = `[The AI speaker for ${t.roleLabel} could not be generated. Check the server's GROQ_API_KEY and try again.]`;
  }

  $('#ai-typing-indicator').hidden = true;
  revealAiSpeech(t, text);
}

function revealAiSpeech(t, fullText) {
  if (Podium.round.aiVoiceEnabled && 'speechSynthesis' in window) {
    revealAiSpeechVoice(t, fullText);
  } else {
    revealAiSpeechTypewriter(t, fullText);
  }
}

function revealAiSpeechTypewriter(t, fullText) {
  const words = fullText.split(/\s+/);
  const revealMs = Math.min(24000, Math.max(6000, words.length * 90));
  let skip = false;
  $('#btn-skip-ai').onclick = () => { skip = true; };
  $('#ai-typing-indicator').hidden = false;
  $('#ai-typing-label').textContent = `${t.speakerName} is speaking…`;
  $('#btn-skip-ai').hidden = false;

  runCountdown({
    duration: t.duration, warning: t.warning, ring: '#timer-ring', display: '#timer-display',
    onComplete: () => {},
  });

  let i = 0;
  const step = Math.max(1, Math.round(words.length / (revealMs / 60)));
  const interval = setInterval(() => {
    if (skip) { i = words.length; }
    i = Math.min(words.length, i + step);
    $('#composer').style.display = '';
    $('#composer-input').disabled = true;
    $('#composer-input').value = words.slice(0, i).join(' ');
    if (i >= words.length) {
      clearInterval(interval);
      $('#ai-typing-indicator').hidden = true;
      Podium.timers.turn && clearInterval(Podium.timers.turn);
      $('#timer-display').textContent = '0:00';
      setTimeout(() => finalizeTurn(t, fullText), 500);
    }
  }, 60);
}

// Delivers the AI's speech as actual synthesized speech (Web Speech API),
// with the text revealing on screen at a natural spoken pace alongside the
// audio. Falls back cleanly to the typewriter reveal if TTS fails outright.
function revealAiSpeechVoice(t, fullText) {
  const words = fullText.split(/\s+/);
  $('#composer').style.display = '';
  $('#composer-input').disabled = true;
  $('#composer-input').value = '';
  $('#ai-typing-indicator').hidden = false;
  $('#ai-typing-label').innerHTML = `<i class="fa-solid fa-volume-high"></i> ${escapeHtml(t.speakerName)} is speaking…`;
  $('#btn-skip-ai').hidden = false;

  runCountdown({
    duration: t.duration, warning: t.warning, ring: '#timer-ring', display: '#timer-display',
    onComplete: () => {},
  });

  let finished = false;
  let i = 0;
  // ~2.6 words/sec approximates natural speaking pace for the on-screen reveal;
  // the actual audio timing (and therefore when the turn finalizes) is driven
  // by the speech synthesis engine itself via onend/onerror below.
  const wordInterval = setInterval(() => {
    if (finished) return;
    i = Math.min(words.length, i + 1);
    $('#composer-input').value = words.slice(0, i).join(' ');
  }, 380);

  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(wordInterval);
    clearTimeout(safetyNet);
    try { window.speechSynthesis.cancel(); } catch (e) {}
    $('#composer-input').value = fullText;
    $('#ai-typing-indicator').hidden = true;
    Podium.timers.turn && clearInterval(Podium.timers.turn);
    $('#timer-display').textContent = '0:00';
    setTimeout(() => finalizeTurn(t, fullText), 400);
  };

  try { window.speechSynthesis.cancel(); } catch (e) {}
  const utter = new SpeechSynthesisUtterance(fullText);
  utter.rate = 1.0;
  utter.onend = finish;
  utter.onerror = finish;
  try { window.speechSynthesis.speak(utter); } catch (e) { finish(); return; }

  // Safety net in case the browser silently never fires onend/onerror.
  const safetyNet = setTimeout(finish, Math.max(8000, words.length * 500));

  $('#btn-skip-ai').onclick = finish;
}

/* ---------- finalize a turn: score-agnostic bookkeeping, transcript, advance ---------- */
async function finalizeTurn(t, text) {
  if (turnLocked) return;
  turnLocked = true;
  clearInterval(Podium.timers.turn);
  stopMic();
  const recording = await stopVideoRecording();

  const hits = FallacyDetector.scan(text);
  pushFallacyFeed(hits, t.speakerName);
  Api.analyzeFallacies({ text }).then((res) => {
    if (res.fallacies && res.fallacies.length) pushFallacyFeed(res.fallacies.map((f) => ({ ...f, severity: (FallacyDetector.meta()[f.id] || {}).defaultSeverity || 'mild' })), t.speakerName);
  }).catch(() => {});

  const entry = {
    turnIndex: t.turnIndex, seatId: t.seatId, role: t.role, roleLabel: t.roleLabel, team: t.team,
    teamName: t.teamName, speakerName: t.speakerName, isHuman: t.isHuman, text, type: t.type,
    durationSeconds: t.duration, timeUsedSeconds: currentTurnElapsed || t.duration, wordCount: wordCount(text),
    pois: currentTurnPois.slice(), hadVideo: currentTurnFrames.length > 0,
  };
  Podium.round.transcript.push(entry);
  appendTranscriptEntryDom(entry);

  if (currentTurnFrames.length) {
    Podium.round.pendingVideoAnalyses = Podium.round.pendingVideoAnalyses || [];
    const p = Api.analyzeFrames({ images: currentTurnFrames }).then((res) => {
      const prior = Podium.round.videoNotes[t.seatId];
      Podium.round.videoNotes[t.seatId] = prior ? `${prior} ${res.notes}` : res.notes;
    }).catch(() => {});
    Podium.round.pendingVideoAnalyses.push(p);
  }
  if (recording && recording.url) {
    Podium.round.videoBlobs[t.turnIndex] = recording.url;
  }

  currentTurnElapsed = 0;
  advanceTurn();
}

function appendTranscriptEntryDom(entry) {
  const tpl = $('#tpl-transcript-entry').content.cloneNode(true);
  tpl.querySelector('.te-role').textContent = entry.roleLabel;
  tpl.querySelector('.te-name').textContent = entry.speakerName;
  tpl.querySelector('.te-team').textContent = `· ${entry.teamName}`;
  tpl.querySelector('.te-text').textContent = entry.text;
  const poiWrap = tpl.querySelector('.te-pois');
  entry.pois.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'te-poi' + (p.accepted ? '' : ' declined');
    div.innerHTML = `<strong>POI from ${escapeHtml(p.from)}:</strong> ${escapeHtml(p.question)} ${p.accepted ? `→ <em>${escapeHtml(p.response)}</em>` : '<em>(declined)</em>'}`;
    poiWrap.appendChild(div);
  });
  $('#transcript-log').prepend(tpl);
}

/* =========================================================
   POINTS OF INFORMATION
   ========================================================= */
function openPoiFlow(t) {
  if (poiCountThisTurn >= 3) { toast('POI limit reached for this speech.', 'warn'); return; }
  const opposing = Podium.round.seats.filter((s) => s.side !== t.side);
  $('#poi-modal-title').textContent = 'Raise a Point of Information';
  const body = $('#poi-modal-body');
  body.innerHTML = `<p class="field-hint">Who is offering the point?</p><div class="composition-grid" id="poi-asker-grid"></div>`;
  $('#poi-modal-actions').innerHTML = '';
  const grid = body.querySelector('#poi-asker-grid');
  opposing.forEach((seat) => {
    const card = document.createElement('div');
    card.className = 'comp-card';
    card.innerHTML = `<i class="fa-solid ${seat.isHuman ? 'fa-user' : 'fa-robot'}"></i><div><h4>${escapeHtml(seat.name)}</h4><p>${escapeHtml(seat.roleName)} · ${escapeHtml(seat.teamName)}</p></div>`;
    on(card, 'click', () => beginPoiAsk(t, seat));
    grid.appendChild(card);
  });
  openModal('poi-modal');
}

async function beginPoiAsk(t, asker) {
  const body = $('#poi-modal-body');
  if (asker.isHuman) {
    body.innerHTML = `<p class="field-hint">Type ${escapeHtml(asker.name)}'s point (kept to a sentence).</p><textarea id="poi-question-input" class="text-input" rows="3" maxlength="200"></textarea>`;
    $('#poi-modal-actions').innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary'; btn.textContent = 'Offer POI';
    on(btn, 'click', () => {
      const q = $('#poi-question-input').value.trim();
      if (!q) { toast('Write a question first.', 'warn'); return; }
      resolvePoi(t, asker, q);
    });
    $('#poi-modal-actions').appendChild(btn);
  } else {
    body.innerHTML = `<p class="field-hint"><i class="fa-solid fa-circle-notch fa-spin"></i> ${escapeHtml(asker.name)} is raising a point…</p>`;
    $('#poi-modal-actions').innerHTML = '';
    try {
      const { question } = await Api.poiQuestion({
        motion: Podium.round.motion, askingRoleName: asker.roleName, askingTeamName: asker.teamName,
        targetRoleName: t.roleLabel, currentSpeechText: $('#composer-input').value || '',
      });
      resolvePoi(t, asker, question);
    } catch (err) {
      toast('Could not generate a POI right now.', 'error');
      closeModal('poi-modal');
    }
  }
}

async function resolvePoi(t, asker, question) {
  const body = $('#poi-modal-body');
  body.innerHTML = `<div class="poi-question-box"><strong>${escapeHtml(asker.name)}:</strong> ${escapeHtml(question)}</div>`;
  poiCountThisTurn++;

  if (t.isHuman) {
    $('#poi-modal-actions').innerHTML = '';
    const acceptBtn = document.createElement('button'); acceptBtn.className = 'btn btn-primary'; acceptBtn.textContent = 'Accept & answer';
    const declineBtn = document.createElement('button'); declineBtn.className = 'btn btn-ghost'; declineBtn.textContent = 'Decline';
    $('#poi-modal-actions').append(declineBtn, acceptBtn);
    on(declineBtn, 'click', () => {
      currentTurnPois.push({ from: asker.name, question, accepted: false, response: '' });
      toast('POI declined.'); closeModal('poi-modal');
    });
    on(acceptBtn, 'click', () => {
      body.insertAdjacentHTML('beforeend', `<textarea id="poi-response-input" class="text-input" rows="2" maxlength="200" placeholder="Your reply…"></textarea>`);
      $('#poi-modal-actions').innerHTML = '';
      const submitBtn = document.createElement('button'); submitBtn.className = 'btn btn-primary'; submitBtn.textContent = 'Submit reply';
      on(submitBtn, 'click', () => {
        const resp = $('#poi-response-input').value.trim() || '(accepted, no verbal reply recorded)';
        currentTurnPois.push({ from: asker.name, question, accepted: true, response: resp });
        closeModal('poi-modal');
      });
      $('#poi-modal-actions').appendChild(submitBtn);
    });
  } else {
    body.insertAdjacentHTML('beforeend', `<p class="field-hint"><i class="fa-solid fa-circle-notch fa-spin"></i> ${escapeHtml(t.speakerName)} is deciding…</p>`);
    $('#poi-modal-actions').innerHTML = '';
    try {
      const result = await Api.poiResponse({ motion: Podium.round.motion, speakerRoleName: t.roleLabel, question });
      currentTurnPois.push({ from: asker.name, question, accepted: !!result.accepted, response: result.response || '' });
      body.insertAdjacentHTML('beforeend', `<div class="poi-question-box">${result.accepted ? `<strong>${escapeHtml(t.speakerName)} accepts:</strong> ${escapeHtml(result.response)}` : `<strong>${escapeHtml(t.speakerName)} declines the point.</strong>`}</div>`);
      const closeBtn = document.createElement('button'); closeBtn.className = 'btn btn-primary'; closeBtn.textContent = 'Continue';
      on(closeBtn, 'click', () => closeModal('poi-modal'));
      $('#poi-modal-actions').appendChild(closeBtn);
    } catch (err) {
      toast('POI response failed.', 'error'); closeModal('poi-modal');
    }
  }
}

/* =========================================================
   CROSS-EXAMINATION (Lincoln-Douglas)
   ========================================================= */
function runCrossExTurn(t) {
  $('#composer').style.display = 'none';
  $('#ai-typing-indicator').hidden = true;
  $('#timer-sub').textContent = 'cross-examination';
  const questioner = Podium.round.seats.find((s) => s.id === t.seatId);
  const answerer = Podium.round.seats.find((s) => s.id !== t.seatId);
  const qaList = [];
  let timeUp = false;

  runCountdown({
    duration: t.duration, warning: t.warning, ring: '#timer-ring', display: '#timer-display',
    onComplete: () => { timeUp = true; renderCrossExControls(); },
  });

  $('#crossex-modal-body').innerHTML = `<p class="field-hint">${escapeHtml(questioner.name)} (${escapeHtml(questioner.roleName)}) cross-examines ${escapeHtml(answerer.name)} (${escapeHtml(answerer.roleName)}).</p><div id="crossex-qa-list"></div>`;
  openModal('crossex-modal');

  function renderQaList() {
    const wrap = $('#crossex-qa-list');
    wrap.innerHTML = qaList.map((qa) => `<div class="crossex-question-box"><strong>${escapeHtml(qa.questioner)}:</strong> ${escapeHtml(qa.question)}<br/><strong>${escapeHtml(qa.answerer)}:</strong> ${escapeHtml(qa.answer)}</div>`).join('');
  }

  function renderCrossExControls() {
    const actions = $('#crossex-modal-actions');
    actions.innerHTML = '';
    if (timeUp) {
      actions.innerHTML = '<p class="field-hint" style="width:100%;text-align:center;">Time\'s up.</p>';
      const finishBtn = document.createElement('button');
      finishBtn.className = 'btn btn-primary btn-block'; finishBtn.textContent = 'Finish cross-examination';
      on(finishBtn, 'click', () => finalizeCrossEx());
      actions.appendChild(finishBtn);
      return;
    }
    const askBtn = document.createElement('button');
    askBtn.className = 'btn btn-primary'; askBtn.textContent = qaList.length ? 'Ask another question' : 'Ask a question';
    on(askBtn, 'click', askQuestion);
    const endBtn = document.createElement('button');
    endBtn.className = 'btn btn-ghost'; endBtn.textContent = 'End cross-ex now';
    on(endBtn, 'click', finalizeCrossEx);
    actions.append(endBtn, askBtn);
  }

  async function askQuestion() {
    const actions = $('#crossex-modal-actions');
    actions.innerHTML = '';
    const priorSpeech = [...Podium.round.transcript].reverse().find((e) => e.seatId === answerer.id);
    if (questioner.isHuman) {
      $('#crossex-modal-body').insertAdjacentHTML('beforeend', `<textarea id="crossex-q-input" class="text-input" rows="2" maxlength="200" placeholder="Ask your question…"></textarea>`);
      const sendBtn = document.createElement('button'); sendBtn.className = 'btn btn-primary'; sendBtn.textContent = 'Send question';
      on(sendBtn, 'click', () => {
        const q = $('#crossex-q-input').value.trim();
        if (!q) return;
        $('#crossex-q-input').remove(); sendBtn.remove();
        answerQuestion(q, priorSpeech);
      });
      actions.appendChild(sendBtn);
    } else {
      $('#crossex-modal-body').insertAdjacentHTML('beforeend', `<p class="field-hint"><i class="fa-solid fa-circle-notch fa-spin"></i> ${escapeHtml(questioner.name)} is thinking of a question…</p>`);
      try {
        const { question } = await Api.crossExQuestion({ motion: Podium.round.motion, questionerRole: questioner.roleName, answererRole: answerer.roleName, opponentSpeechText: priorSpeech ? priorSpeech.text : '' });
        answerQuestion(question, priorSpeech);
      } catch (err) { toast('Question generation failed.', 'error'); renderCrossExControls(); }
    }
  }

  async function answerQuestion(question, priorSpeech) {
    const actions = $('#crossex-modal-actions');
    actions.innerHTML = '';
    $('.field-hint:last-of-type', $('#crossex-modal-body'))?.remove?.();
    if (answerer.isHuman) {
      $('#crossex-modal-body').insertAdjacentHTML('beforeend', `<div class="crossex-question-box"><strong>${escapeHtml(questioner.name)} asks:</strong> ${escapeHtml(question)}</div><textarea id="crossex-a-input" class="text-input" rows="2" maxlength="200" placeholder="Answer…"></textarea>`);
      const sendBtn = document.createElement('button'); sendBtn.className = 'btn btn-primary'; sendBtn.textContent = 'Send answer';
      on(sendBtn, 'click', () => {
        const a = $('#crossex-a-input').value.trim() || '(no answer given)';
        $('#crossex-a-input').remove(); sendBtn.remove();
        qaList.push({ questioner: questioner.name, answerer: answerer.name, question, answer: a });
        renderQaList(); renderCrossExControls();
      });
      actions.appendChild(sendBtn);
    } else {
      try {
        const { answer } = await Api.crossExAnswer({ motion: Podium.round.motion, questionerRole: questioner.roleName, answererRole: answerer.roleName, question });
        qaList.push({ questioner: questioner.name, answerer: answerer.name, question, answer });
        renderQaList(); renderCrossExControls();
      } catch (err) { toast('Answer generation failed.', 'error'); renderCrossExControls(); }
    }
  }

  function finalizeCrossEx() {
    clearInterval(Podium.timers.turn);
    closeModal('crossex-modal');
    const text = qaList.length
      ? qaList.map((qa) => `Q (${qa.questioner}): ${qa.question}\nA (${qa.answerer}): ${qa.answer}`).join('\n\n')
      : '(No questions were asked during this cross-examination.)';
    finalizeTurn(t, text);
  }

  renderCrossExControls();
}

/* =========================================================
   PRACTICE MODE — AI SUGGESTIONS
   ========================================================= */
async function requestSuggestion(t) {
  const panel = $('#suggestion-panel');
  panel.hidden = false;
  panel.innerHTML = `<p class="field-hint"><i class="fa-solid fa-circle-notch fa-spin"></i> thinking of angles…</p>`;
  try {
    const { suggestions } = await Api.suggest({
      motion: Podium.round.motion, roleName: t.roleLabel, teamName: t.teamName, side: t.side, transcript: Podium.round.transcript,
    });
    panel.innerHTML = '';
    (suggestions || []).forEach((s) => {
      const tpl = $('#tpl-suggestion-item').content.cloneNode(true);
      tpl.querySelector('span').textContent = s;
      panel.appendChild(tpl);
    });
  } catch (err) {
    panel.innerHTML = `<p class="field-hint">Couldn't fetch a suggestion right now.</p>`;
  }
}

/* =========================================================
   END ROUND EARLY / FINISH
   ========================================================= */
async function endDebateEarly() {
  const ok = await confirmDialog('End this round?', 'Remaining speakers will be skipped and the round will be judged on what has been said so far.');
  if (!ok) return;
  clearInterval(Podium.timers.turn);
  stopMic(); stopVideoRecording();
  finishRound();
}

function finishRound() {
  showRawView('debate'); // stay put while judging overlays via toast/loading
  toast('Round complete — judging now…');
  judgeRound();
}

/* =========================================================
   MEDIA — voice input (Web Speech API) & video (MediaRecorder)
   ========================================================= */
let recognition = null;
let recognizing = false;

function micSupported() { return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window; }

function startMic() {
  if (!micSupported()) { toast('Voice input is not supported in this browser — try Chrome.', 'warn'); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  let baseText = $('#composer-input').value;
  if (baseText && !baseText.endsWith(' ')) baseText += ' ';

  recognition.onresult = (event) => {
    let finalTranscript = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    if (finalTranscript) baseText += finalTranscript + ' ';
    $('#composer-input').value = baseText + interim;
    handleComposerInput();
  };
  recognition.onerror = () => { /* transient errors are common — ignore */ };
  recognition.onend = () => { if (recognizing) recognition.start(); }; // keep listening until user stops
  recognition.start();
  recognizing = true;
  $('#btn-mic').classList.add('is-recording');
}

function stopMic() {
  recognizing = false;
  if (recognition) { try { recognition.stop(); } catch (e) {} recognition = null; }
  $('#btn-mic') && $('#btn-mic').classList.remove('is-recording');
}

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let frameGrabInterval = null;

async function startVideoPreview() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    $('#video-preview').srcObject = mediaStream;
  } catch (err) {
    toast('Camera/mic access was denied or unavailable.', 'error');
  }
}

function stopVideoPreview() {
  if (mediaStream) { mediaStream.getTracks().forEach((tr) => tr.stop()); mediaStream = null; }
  const v = $('#video-preview'); if (v) v.srcObject = null;
  clearInterval(frameGrabInterval);
  $('#rec-indicator').hidden = true;
  $('#btn-video-toggle').classList.remove('is-recording');
  $('#btn-video-toggle').innerHTML = '<i class="fa-solid fa-circle-dot"></i> Start recording';
}

function toggleVideoRecording() {
  if (!mediaStream) { toast('Enable the camera first.', 'warn'); return; }
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  recordedChunks = [];
  currentTurnFrames = [];
  try {
    mediaRecorder = new MediaRecorder(mediaStream);
  } catch (err) {
    toast('Recording is not supported in this browser.', 'error'); return;
  }
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.start();
  $('#rec-indicator').hidden = false;
  $('#btn-video-toggle').classList.add('is-recording');
  $('#btn-video-toggle').innerHTML = '<i class="fa-solid fa-stop"></i> Stop recording';

  // Also auto-transcribe speech into the composer while recording.
  if (micSupported()) startMic();

  // Grab up to 4 still frames over the course of the recording for body-language analysis.
  let grabbed = 0;
  frameGrabInterval = setInterval(() => {
    if (grabbed >= 4) { clearInterval(frameGrabInterval); return; }
    grabCurrentFrame();
    grabbed++;
  }, 8000);
}

function grabCurrentFrame() {
  const video = $('#video-preview');
  if (!video || !video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = Math.round(320 * (video.videoHeight / video.videoWidth));
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  currentTurnFrames.push(canvas.toDataURL('image/jpeg', 0.7));
}

function stopVideoRecording() {
  clearInterval(frameGrabInterval);
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return null;
  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = recordedChunks.length ? URL.createObjectURL(blob) : null;
      $('#rec-indicator').hidden = true;
      $('#btn-video-toggle').classList.remove('is-recording');
      resolve(url ? { url } : null);
    };
    mediaRecorder.stop();
  });
}

/* =========================================================
   COMPOSER wiring — word count, live fallacy scan, input tabs
   ========================================================= */
let fallacyScanTimeout = null;
function handleComposerInput() {
  const text = $('#composer-input').value;
  $('#word-count').textContent = `${wordCount(text)} words`;
  clearTimeout(fallacyScanTimeout);
  fallacyScanTimeout = setTimeout(() => {
    const hits = FallacyDetector.scan(text);
    renderComposerHighlight(text, hits);
    renderLiveFallacyFlags(hits);
  }, 350);
}

function initComposer() {
  on($('#composer-input'), 'input', handleComposerInput);
  on($('#composer-input'), 'scroll', () => { $('#composer-highlight').scrollTop = $('#composer-input').scrollTop; });
  on($('#composer-input'), 'keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && $('#composer-input') === document.activeElement && !$('#composer-input').disabled) {
      e.preventDefault(); $('#btn-send-speech').click();
    }
  });

  $$('.input-tab').forEach((tab) => on(tab, 'click', () => {
    $$('.input-tab').forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    const mode = tab.dataset.mode;
    $('#video-input-wrap').hidden = mode !== 'video';
    if (mode === 'video') startVideoPreview(); else stopVideoPreview();
    if (mode !== 'voice') stopMic();
  }));

  on($('#btn-mic'), 'click', () => { recognizing ? stopMic() : startMic(); });
  on($('#btn-video-toggle'), 'click', toggleVideoRecording);
  on($('#btn-suggest'), 'click', () => requestSuggestion(currentTurn()));
  on($('#btn-end-debate-early'), 'click', endDebateEarly);
  // #btn-skip-ai's click handler is (re)bound per-turn inline in revealAiSpeech().
}

/* =========================================================
   JUDGING + RESULTS
   ========================================================= */
async function judgeRound() {
  showLoading('Judging the round…', 'Scoring every speaker out of 100 and ranking the result');
  try {
    const speakersPayload = Podium.round.seats.map((s) => ({ id: s.id, role: s.role, roleName: s.roleName, team: s.team, teamName: s.teamName, isHuman: s.isHuman, name: s.name }));
    const transcriptPayload = Podium.round.transcript.map((e) => ({ role: e.roleLabel, teamName: e.teamName, speakerName: e.speakerName, text: e.text, pois: e.pois }));
    const scores = await Api.judge({ style: Podium.round.style, motion: Podium.round.motion, speakers: speakersPayload, transcript: transcriptPayload });
    Podium.round.scores = scores;
    renderResults();
    saveRoundToHistory();
    hideLoading();
    showRawView('results');
    Confetti.burst();
  } catch (err) {
    console.error(err);
    hideLoading();
    toast('Judging failed — check your Groq API key on the server.', 'error');
  }
}

function seatById(id) { return Podium.round.seats.find((s) => s.id === id); }

function renderResults() {
  const scores = Podium.round.scores;
  const ranked = [...scores.speakerScores].sort((a, b) => b.total - a.total);

  $('#results-motion-label').textContent = Podium.round.motion;

  if (Podium.round.style === 'bp' && scores.teamRanking && scores.teamRanking.length === 4) {
    $('#team-podium-card').hidden = false;
    renderBpPodium(scores.teamRanking);
    const first = scores.teamRanking[0];
    $('#winner-title').innerHTML = `<i class="fa-solid fa-flag-checkered"></i> ${escapeHtml(first.teamName)} finishes 1st`;
    $('#winner-reason').textContent = scores.winningTeamReason || '';
  } else {
    $('#team-podium-card').hidden = true;
    const winningTeam = Podium.round.formatDef.teams.find((tm) => tm.id === scores.winningTeam || tm.name === scores.winningTeam);
    $('#winner-title').innerHTML = `<i class="fa-solid fa-flag-checkered"></i> ${escapeHtml(winningTeam ? winningTeam.name : scores.winningTeam)} wins the round`;
    $('#winner-reason').textContent = scores.winningTeamReason || '';
  }

  const best = seatById(scores.bestSpeakerId);
  const bestScore = ranked.find((s) => s.id === scores.bestSpeakerId);
  if (best) {
    $('#best-speaker-name').textContent = best.name;
    $('#best-speaker-meta').textContent = `${best.roleName} · ${best.teamName}`;
    $('#best-speaker-score').innerHTML = `${bestScore ? bestScore.total : '—'}<span>/100</span>`;
    $('#best-speaker-reason').textContent = scores.bestSpeakerReason || '';
  }

  const rankWrap = $('#rankings-list');
  rankWrap.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  ranked.forEach((s, i) => {
    const seat = seatById(s.id);
    const tpl = $('#tpl-rank-row').content.cloneNode(true);
    const row = tpl.querySelector('.rank-row');
    row.classList.toggle('is-best', s.id === scores.bestSpeakerId);
    tpl.querySelector('.rank-medal').textContent = medals[i] || `#${i + 1}`;
    tpl.querySelector('.rank-name').textContent = seat ? seat.name : s.id;
    tpl.querySelector('.rank-role').textContent = seat ? `${seat.roleName} · ${seat.teamName}` : '';
    tpl.querySelector('.rank-score').textContent = `${s.total}/100`;
    rankWrap.appendChild(tpl);
    requestAnimationFrame(() => { row.querySelector('.rank-bar-fill').style.width = `${s.total}%`; });
  });

  const breakdownWrap = $('#score-breakdown-list');
  breakdownWrap.innerHTML = '';
  ranked.forEach((s) => {
    const seat = seatById(s.id);
    const card = $('#tpl-breakdown-card').content.cloneNode(true);
    card.querySelector('.breakdown-name').textContent = `${seat ? seat.name : s.id} — ${s.total}/100`;
    const barsWrap = card.querySelector('.breakdown-bars');
    [['content', 'Content', 40], ['strategy', 'Strategy', 30], ['style', 'Style', 20], ['rebuttal', 'Rebuttal', 10]].forEach(([key, label, max]) => {
      const bar = $('#tpl-breakdown-bar').content.cloneNode(true);
      bar.querySelector('.bb-label').textContent = label;
      bar.querySelector('.bb-value').textContent = `${s[key]}/${max}`;
      const fill = bar.querySelector('.bb-fill');
      fill.classList.add(key);
      barsWrap.appendChild(bar);
      requestAnimationFrame(() => { fill.style.width = `${(s[key] / max) * 100}%`; });
    });
    breakdownWrap.appendChild(card);
  });
}

function renderBpPodium(teamRanking) {
  const stage = $('#podium-stage');
  stage.innerHTML = '';
  const heightByRank = { 1: 190, 2: 148, 3: 110, 4: 78 };
  teamRanking.forEach((t) => {
    const block = document.createElement('div');
    block.className = `podium-block rank-${t.rank}`;
    block.innerHTML = `
      <span class="podium-rank-badge">${t.rank}</span>
      <span class="podium-team-name">${escapeHtml(t.teamName)}</span>
      <span class="podium-bench">${escapeHtml(bpBenchLabel(t.team))}</span>
      <span class="podium-score">${t.total}</span>
      <span class="podium-riser" style="height:${heightByRank[t.rank] || 60}px"></span>
    `;
    stage.appendChild(block);
  });
}

function bpBenchLabel(teamId) {
  return { og: 'Opening Government', oo: 'Opening Opposition', cg: 'Closing Government', co: 'Closing Opposition' }[teamId] || teamId;
}

/* =========================================================
   CRITIQUE SESSION
   ========================================================= */
function typewriterReveal(el, text) {
  el.textContent = '';
  let i = 0;
  const total = text.length;
  if (!total) return;
  const totalMs = Math.min(5000, Math.max(900, total * 9));
  const stepMs = Math.max(8, totalMs / total);
  const timer = setInterval(() => {
    i++; el.textContent = text.slice(0, i);
    if (i >= total) clearInterval(timer);
  }, stepMs);
}

async function goToCritique() {
  showRawView('critique');
  if (!Podium.round.critique) await runCritique(); else renderCritique();
  startCritiqueClock();
}

async function runCritique() {
  showLoading('Preparing your critique…', 'Reviewing the transcript, scores, and any recorded video');
  if (Podium.round.pendingVideoAnalyses && Podium.round.pendingVideoAnalyses.length) {
    await Promise.allSettled(Podium.round.pendingVideoAnalyses);
  }
  try {
    const speakersPayload = Podium.round.seats.map((s) => ({ id: s.id, role: s.role, roleName: s.roleName, teamName: s.teamName, name: s.name }));
    const transcriptPayload = Podium.round.transcript.map((e) => ({ role: e.roleLabel, teamName: e.teamName, speakerName: e.speakerName, text: e.text }));
    const critique = await Api.critique({
      style: Podium.round.style, motion: Podium.round.motion, speakers: speakersPayload, transcript: transcriptPayload,
      scores: Podium.round.scores, videoNotes: Podium.round.videoNotes,
    });
    Podium.round.critique = critique;
    hideLoading();
    renderCritique();
    saveRoundToHistory();
  } catch (err) {
    hideLoading();
    $('#critique-overall').textContent = "Critique generation failed — check your Groq API key on the server.";
    toast('Critique failed.', 'error');
  }
}

function renderCritique() {
  const scores = Podium.round.scores;
  const critique = Podium.round.critique;
  const ranked = [...scores.speakerScores].sort((a, b) => b.total - a.total);
  const best = seatById(scores.bestSpeakerId);
  const bestScore = ranked.find((s) => s.id === scores.bestSpeakerId);

  $('#critique-best-speaker-line').textContent = critique.bestSpeakerRecap || `${best ? best.name : ''} was Best Speaker with ${bestScore ? bestScore.total : ''}/100.`;

  const board = $('#critique-scoreboard');
  board.innerHTML = '';
  ranked.forEach((s) => {
    const seat = seatById(s.id);
    const div = document.createElement('div');
    div.className = 'cs-item' + (s.id === scores.bestSpeakerId ? ' is-best' : '');
    div.innerHTML = `<p class="cs-role">${escapeHtml(seat ? seat.roleName : '')}</p><p class="cs-name">${escapeHtml(seat ? seat.name : s.id)}${s.id === scores.bestSpeakerId ? ' 👑' : ''}</p><p class="cs-score">${s.total}<span style="font-size:0.6em;color:var(--text-faint)">/100</span></p>`;
    board.appendChild(div);
  });

  typewriterReveal($('#critique-overall'), critique.overallAnalysis || '');

  const psWrap = $('#critique-per-speaker');
  psWrap.innerHTML = '';
  (critique.perSpeaker || []).forEach((p) => {
    const seat = seatById(p.id);
    const scoreEntry = ranked.find((s) => s.id === p.id);
    const tpl = $('#tpl-per-speaker-feedback').content.cloneNode(true);
    tpl.querySelector('.ps-name').textContent = seat ? `${seat.name} — ${seat.roleName}` : p.id;
    tpl.querySelector('.ps-score').textContent = scoreEntry ? `${scoreEntry.total}/100` : '';
    tpl.querySelector('.ps-strengths').textContent = p.strengths || '';
    tpl.querySelector('.ps-delivery').textContent = p.delivery || '';
    tpl.querySelector('.ps-rebuttal').textContent = p.rebuttalWork || '';
    tpl.querySelector('.ps-improve').textContent = p.improvement || '';
    psWrap.appendChild(tpl);
  });

  const kmWrap = $('#critique-key-moments');
  kmWrap.innerHTML = '';
  (critique.keyMoments || []).forEach((k) => {
    const tpl = $('#tpl-key-moment').content.cloneNode(true);
    tpl.querySelector('.km-label').textContent = k.label;
    tpl.querySelector('.km-detail').textContent = k.detail;
    kmWrap.appendChild(tpl);
  });

  $('#critique-tips').innerHTML = (critique.tips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('');

  const videoCard = $('#critique-video-card');
  if (critique.videoAnalysis && critique.videoAnalysis.length) {
    videoCard.hidden = false;
    $('#critique-video-analysis').innerHTML = critique.videoAnalysis.map((v) => {
      const seat = seatById(v.id);
      return `<p style="margin-bottom:10px;"><strong>${escapeHtml(seat ? seat.name : v.id)}:</strong> ${escapeHtml(v.notes)}</p>`;
    }).join('');
  } else {
    videoCard.hidden = true;
  }
}

function startCritiqueClock() {
  let remaining = 420;
  clearInterval(Podium.timers.critique);
  $('#critique-clock').textContent = formatTime(remaining);
  Podium.timers.critique = setInterval(() => {
    remaining--;
    $('#critique-clock').textContent = formatTime(Math.max(0, remaining));
    if (remaining <= 0) clearInterval(Podium.timers.critique);
  }, 1000);
  $('#btn-skip-critique-timer').onclick = () => { clearInterval(Podium.timers.critique); $('#critique-clock').textContent = '0:00'; };
}

/* =========================================================
   EXPORT / SHARE / PRINT / NEW ROUND
   ========================================================= */
function buildExportText() {
  const r = Podium.round;
  const lines = [];
  lines.push('PODIUM — Debate Transcript');
  lines.push(`Motion: ${r.motion}`);
  lines.push(`Format: ${r.formatDef.name}`);
  lines.push(`Date: ${new Date(r.startedAt).toLocaleString()}`);
  lines.push('');
  (r.transcript || []).forEach((e) => {
    lines.push(`--- ${e.roleLabel} (${e.teamName}) — ${e.speakerName} ---`);
    lines.push(e.text);
    (e.pois || []).forEach((p) => lines.push(`  POI from ${p.from}: "${p.question}" ${p.accepted ? `-> "${p.response}"` : '(declined)'}`));
    lines.push('');
  });
  if (r.scores) {
    lines.push('=== SCORES (out of 100) ===');
    lines.push(`Winning team: ${r.scores.winningTeam}`);
    const best = seatById(r.scores.bestSpeakerId);
    lines.push(`Best Speaker: ${best ? best.name : r.scores.bestSpeakerId}`);
    lines.push('');
    [...r.scores.speakerScores].sort((a, b) => b.total - a.total).forEach((s) => {
      const seat = seatById(s.id);
      lines.push(`${seat ? seat.name : s.id} (${seat ? seat.roleName : ''}): ${s.total}/100  [content ${s.content}/40, strategy ${s.strategy}/30, style ${s.style}/20, rebuttal ${s.rebuttal}/10]`);
    });
  }
  if (r.critique) {
    lines.push('');
    lines.push('=== CRITIQUE ===');
    lines.push(r.critique.overallAnalysis || '');
    lines.push('');
    lines.push('Tips:');
    (r.critique.tips || []).forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  }
  return lines.join('\n');
}

function exportTranscript() {
  const blob = new Blob([buildExportText()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `podium-${Podium.round.style}-${Date.now()}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
}

async function shareResult() {
  try {
    const payload = {
      motion: Podium.round.motion, style: Podium.round.style, styleName: Podium.round.formatDef.name,
      seats: Podium.round.seats, scores: Podium.round.scores, critique: Podium.round.critique,
    };
    const { id } = await Api.share(payload);
    const url = `${location.origin}/share/${id}`;
    try { await navigator.clipboard.writeText(url); toast('Share link copied to clipboard!'); }
    catch (e) { toast(`Share link: ${url}`, 'warn'); }
  } catch (err) { toast('Sharing failed.', 'error'); }
}

function resetToSetup() {
  clearInterval(Podium.timers.turn); clearInterval(Podium.timers.prep); clearInterval(Podium.timers.critique);
  stopMic(); stopVideoPreview();
  Podium.round = null;
  Podium.config = { style: null, compositionMode: null, humanCount: 1, ldHumanSide: 'aff', roleAssignments: {}, motion: '', persona: 'standard', difficulty: 'intermediate', asianSpeechLength: 420, prepEnabled: true, practiceMode: false, aiVoiceEnabled: true };
  Podium.wizardStep = 1;
  goToWizardStep(1);
  $('#input-motion').value = '';
  $('#step1-next').disabled = true; $('#step2-next').disabled = true; $('#step4-next').disabled = true;
  $$('.wp-dot').forEach((d) => { d.classList.remove('is-active', 'is-done'); if (d.dataset.step === '1') d.classList.add('is-active'); });
  switchView('setup');
}

/* =========================================================
   HISTORY (localStorage)
   ========================================================= */
const HISTORY_KEY = 'podium_history';
function loadHistoryList() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; } }

function saveRoundToHistory() {
  if (!Podium.round.scores) return;
  const list = loadHistoryList();
  const idx = list.findIndex((r) => r.id === Podium.round.id);
  const summary = {
    id: Podium.round.id, motion: Podium.round.motion, style: Podium.round.style, styleName: Podium.round.formatDef.name,
    date: Podium.round.startedAt, scores: Podium.round.scores, critique: Podium.round.critique,
    seats: Podium.round.seats.map((s) => ({ id: s.id, role: s.role, roleName: s.roleName, teamName: s.teamName, name: s.name, isHuman: s.isHuman })),
  };
  if (idx >= 0) list[idx] = summary; else list.unshift(summary);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 200)));
}

function renderHistoryView() {
  const styleFilter = $('#history-filter-style').value;
  const sort = $('#history-filter-sort').value;
  let list = loadHistoryList();
  if (styleFilter !== 'all') list = list.filter((r) => r.style === styleFilter);
  const avgOf = (r) => r.scores ? r.scores.speakerScores.reduce((a, s) => a + s.total, 0) / r.scores.speakerScores.length : 0;
  list.sort((a, b) => sort === 'score' ? avgOf(b) - avgOf(a) : b.date - a.date);

  const wrap = $('#history-list');
  wrap.innerHTML = '';
  $('#history-empty').hidden = list.length > 0;
  list.forEach((item) => {
    const tpl = $('#tpl-history-item').content.cloneNode(true);
    const btn = tpl.querySelector('.history-item');
    tpl.querySelector('.history-motion').textContent = item.motion;
    tpl.querySelector('.history-meta').textContent = `${item.styleName} · ${new Date(item.date).toLocaleDateString()}`;
    tpl.querySelector('.history-score').textContent = `${Math.round(avgOf(item))}`;
    on(btn, 'click', () => viewHistoryItem(item));
    wrap.appendChild(tpl);
  });
}

function viewHistoryItem(item) {
  Podium.round = {
    id: item.id, style: item.style, formatDef: Podium.formats[item.style], motion: item.motion,
    seats: item.seats, transcript: [], scores: item.scores, critique: item.critique,
    videoNotes: {}, pendingVideoAnalyses: [], startedAt: item.date,
  };
  renderResults();
  showRawView('results');
}

/* =========================================================
   DASHBOARD
   ========================================================= */
let progressChart = null;
let breakdownChart = null;

function renderDashboardView() {
  const history = loadHistoryList();
  const wrap = $('#stat-cards');
  wrap.innerHTML = '';

  const totalRounds = history.length;
  const humanScores = [];
  const bestSpeakerWins = history.filter((h) => (h.seats || []).some((s) => s.isHuman && s.id === (h.scores || {}).bestSpeakerId)).length;
  history.forEach((h) => (h.scores?.speakerScores || []).forEach((s) => {
    const seat = (h.seats || []).find((se) => se.id === s.id);
    if (seat && seat.isHuman) humanScores.push(s.total);
  }));
  const avgScore = humanScores.length ? Math.round(humanScores.reduce((a, b) => a + b, 0) / humanScores.length) : 0;
  const formatCounts = {};
  history.forEach((h) => { formatCounts[h.styleName] = (formatCounts[h.styleName] || 0) + 1; });
  const favFormat = Object.entries(formatCounts).sort((a, b) => b[1] - a[1])[0];

  [[totalRounds, 'Rounds debated'], [avgScore || '—', 'Your avg. score'], [bestSpeakerWins, 'Best Speaker awards'], [favFormat ? favFormat[0] : '—', 'Favorite format']].forEach(([val, label]) => {
    const tpl = $('#tpl-stat-card').content.cloneNode(true);
    tpl.querySelector('.stat-value').textContent = val;
    tpl.querySelector('.stat-label').textContent = label;
    wrap.appendChild(tpl);
  });

  const progressData = history.slice(0, 12).reverse().map((h, i) => {
    const scores = (h.scores?.speakerScores || []).filter((s) => (h.seats || []).find((se) => se.id === s.id && se.isHuman));
    const avg = scores.length ? scores.reduce((a, s) => a + s.total, 0) / scores.length : null;
    return { label: `#${i + 1}`, avg };
  }).filter((d) => d.avg !== null);

  if (window.Chart) {
    progressChart && progressChart.destroy();
    progressChart = new Chart($('#chart-progress'), {
      type: 'line',
      data: { labels: progressData.map((d) => d.label), datasets: [{ label: 'Avg score', data: progressData.map((d) => d.avg), borderColor: '#f093fb', backgroundColor: 'rgba(240,147,251,0.2)', tension: 0.35, fill: true }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { color: '#aaa' } }, x: { ticks: { color: '#aaa' } } } },
    });

    const dims = ['content', 'strategy', 'style', 'rebuttal'];
    const maxes = [40, 30, 20, 10];
    const dimAverages = dims.map((d, i) => {
      const vals = [];
      history.forEach((h) => (h.scores?.speakerScores || []).forEach((s) => { const seat = (h.seats || []).find((se) => se.id === s.id); if (seat && seat.isHuman) vals.push((s[d] / maxes[i]) * 100); }));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
    breakdownChart && breakdownChart.destroy();
    breakdownChart = new Chart($('#chart-breakdown'), {
      type: 'bar',
      data: { labels: ['Content', 'Strategy', 'Style', 'Rebuttal'], datasets: [{ label: '% of max', data: dimAverages, backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#00d2ff'] }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { color: '#aaa' } }, x: { ticks: { color: '#aaa' } } } },
    });
  }

  const tracker = {};
  history.forEach((h) => (h.scores?.speakerScores || []).forEach((s) => {
    const seat = (h.seats || []).find((se) => se.id === s.id);
    if (!seat || !seat.isHuman) return;
    const key = seat.roleName;
    tracker[key] = tracker[key] || { total: 0, count: 0 };
    tracker[key].total += s.total; tracker[key].count += 1;
  }));
  const trackerWrap = $('#speaker-tracker');
  const entries = Object.entries(tracker);
  $('#tracker-empty').hidden = entries.length > 0;
  trackerWrap.innerHTML = entries.map(([role, v]) => `<div class="tracker-row"><span>${escapeHtml(role)}</span><span>${Math.round(v.total / v.count)}/100 avg · ${v.count} round${v.count === 1 ? '' : 's'}</span></div>`).join('');
}

/* =========================================================
   FORMAT GUIDE
   ========================================================= */
let guideData = null;
let currentGuideFormat = 'bp';

async function loadGuideData() {
  if (guideData) return guideData;
  guideData = await fetch('/data/guide.json').then((r) => r.json());
  return guideData;
}

function guideBenchGrid(benches) {
  return `<div class="bench-grid">${benches.map((bench) => `
    <div class="bench-card">
      <p class="bench-card-title"><i class="fa-solid fa-people-group"></i> ${escapeHtml(bench.team)}</p>
      ${bench.speakers.map((sp) => `
        <div class="guide-role">
          <p class="guide-role-name">${escapeHtml(sp.role)}</p>
          <ul class="guide-duties">${sp.duties.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
        </div>`).join('')}
    </div>`).join('')}</div>`;
}

function guideQanda(qanda) {
  return `<div class="qanda-card">
    <p class="qanda-title"><i class="fa-solid fa-comments"></i> ${escapeHtml(qanda.title)}</p>
    <p class="qanda-explanation">${escapeHtml(qanda.explanation)}</p>
    <ul class="qanda-rules">${qanda.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
  </div>`;
}

function guideKeyConcepts(list) {
  return `<ol class="bullet-list numbered">${list.map((k) => `<li>${escapeHtml(k)}</li>`).join('')}</ol>`;
}

function renderGuideFormat(fmt) {
  if (fmt.id === 'bp' || fmt.id === 'asian') {
    const orderRows = fmt.speakingOrder.map(([role, time]) => `<tr><td>${escapeHtml(role)}</td><td>${escapeHtml(time)}</td></tr>`).join('');
    const summaryTable = fmt.summaryTable ? `
      <div class="glass guide-section">
        <h3 class="sidebar-title"><i class="fa-solid fa-table-list"></i> Quick reference</h3>
        <table class="guide-table"><thead><tr><th>Speaker</th><th>Main role</th></tr></thead>
          <tbody>${fmt.summaryTable.map(([a, b]) => `<tr><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`).join('')}</tbody>
        </table>
      </div>` : '';

    return `
      <div class="glass guide-section">
        <p class="guide-tagline">${escapeHtml(fmt.tagline)}</p>
        <p class="guide-summary">${escapeHtml(fmt.summary)}</p>
        ${guideBenchGrid(fmt.benches)}
      </div>
      <div class="glass guide-section">
        <h3 class="sidebar-title"><i class="fa-solid fa-list-ol"></i> Speaking order</h3>
        <table class="guide-table"><thead><tr><th>Speaker</th><th>Time</th></tr></thead><tbody>${orderRows}</tbody></table>
      </div>
      ${summaryTable}
      <div class="glass guide-section">
        <h3 class="sidebar-title"><i class="fa-solid fa-hand"></i> Question &amp; answer session</h3>
        ${guideQanda(fmt.qanda)}
      </div>
      <div class="glass guide-section">
        <h3 class="sidebar-title"><i class="fa-solid fa-key"></i> Key concepts</h3>
        ${guideKeyConcepts(fmt.keyConcepts)}
      </div>`;
  }

  // Lincoln-Douglas — two sides instead of benches, plus a speech-by-speech timing table.
  const orderRows = fmt.speakingOrderTable.map(([speech, speaker, time]) =>
    `<tr><td>${escapeHtml(speech)}</td><td>${escapeHtml(speaker)}</td><td>${escapeHtml(time)}</td></tr>`).join('');
  const sides = `<div class="bench-grid">${fmt.sides.map((side) => `
    <div class="bench-card">
      <p class="bench-card-title"><i class="fa-solid fa-user"></i> ${escapeHtml(side.role)}</p>
      <div class="guide-role">
        <p class="guide-role-name">Role in the round</p>
        <ul class="guide-duties">${side.duties.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
      </div>
      <div class="guide-role">
        <p class="guide-role-name">Responsibilities</p>
        <ul class="guide-duties">${side.responsibilities.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
      </div>
    </div>`).join('')}</div>`;

  return `
    <div class="glass guide-section">
      <p class="guide-tagline">${escapeHtml(fmt.tagline)}</p>
      <p class="guide-summary">${escapeHtml(fmt.summary)}</p>
      ${sides}
    </div>
    <div class="glass guide-section">
      <h3 class="sidebar-title"><i class="fa-solid fa-list-ol"></i> Speaking order</h3>
      <table class="guide-table"><thead><tr><th>Speech</th><th>Speaker</th><th>Time</th></tr></thead><tbody>${orderRows}</tbody></table>
      <p class="guide-order-note">${escapeHtml(fmt.speakingOrderNote)}</p>
    </div>
    <div class="glass guide-section">
      <h3 class="sidebar-title"><i class="fa-solid fa-hand"></i> Question &amp; answer session</h3>
      ${guideQanda(fmt.qanda)}
    </div>
    <div class="glass guide-section">
      <h3 class="sidebar-title"><i class="fa-solid fa-key"></i> Key concepts</h3>
      ${guideKeyConcepts(fmt.keyConcepts)}
    </div>`;
}

async function renderGuideView() {
  const data = await loadGuideData();
  $('#guide-content').innerHTML = renderGuideFormat(data[currentGuideFormat]);
}

function initGuide() {
  $$('#guide-format-picker .segment').forEach((btn) => on(btn, 'click', () => {
    $$('#guide-format-picker .segment').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    currentGuideFormat = btn.dataset.format;
    renderGuideView();
  }));
  initGuideChat();
}

/* ---------- Guide AI chatbot ---------- */
let guideChatHistory = []; // [{ role: 'user'|'ai', text }]
let guideChatBusy = false;

const GUIDE_CHAT_SUGGESTIONS = [
  'What does the Government Whip do?',
  "What's the difference between BP and Asian Parliamentary?",
  'How many POIs can I offer, and when?',
  'How does Cross-Examination work in LD?',
  'What makes a good Closing Government extension?',
];

function renderGuideChatSuggestions() {
  const wrap = $('#guide-chat-suggestions');
  wrap.innerHTML = '';
  GUIDE_CHAT_SUGGESTIONS.forEach((q) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'guide-chat-chip';
    chip.textContent = q;
    on(chip, 'click', () => sendGuideChatMessage(q));
    wrap.appendChild(chip);
  });
}

function appendGuideChatBubble(role, text, extraClass) {
  const wrap = $('#guide-chat-messages');
  const bubble = document.createElement('div');
  bubble.className = `guide-chat-msg ${role}${extraClass ? ' ' + extraClass : ''}`;
  bubble.textContent = text;
  wrap.appendChild(bubble);
  wrap.scrollTop = wrap.scrollHeight;
  return bubble;
}

async function sendGuideChatMessage(question) {
  const q = (question || '').trim();
  if (!q || guideChatBusy) return;
  guideChatBusy = true;
  $('#guide-chat-input').value = '';
  $('#guide-chat-send').disabled = true;

  appendGuideChatBubble('user', q);
  guideChatHistory.push({ role: 'user', text: q });

  const thinking = appendGuideChatBubble('ai', '', 'thinking');
  thinking.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';

  try {
    const { answer } = await Api.guideAsk({ question: q, format: currentGuideFormat, history: guideChatHistory.slice(0, -1) });
    thinking.classList.remove('thinking');
    thinking.textContent = answer;
    guideChatHistory.push({ role: 'ai', text: answer });
  } catch (err) {
    thinking.classList.remove('thinking');
    thinking.textContent = "Sorry, I couldn't answer that — check the server's Groq API key and try again.";
  } finally {
    guideChatBusy = false;
    $('#guide-chat-send').disabled = false;
    $('#guide-chat-messages').scrollTop = $('#guide-chat-messages').scrollHeight;
  }
}

function clearGuideChat() {
  guideChatHistory = [];
  $('#guide-chat-messages').innerHTML = '<div class="guide-chat-msg ai">Chat cleared. Ask me anything about British Parliamentary, Asian Parliamentary, or Lincoln-Douglas.</div>';
}

function initGuideChat() {
  renderGuideChatSuggestions();
  on($('#guide-chat-send'), 'click', () => sendGuideChatMessage($('#guide-chat-input').value));
  on($('#guide-chat-input'), 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendGuideChatMessage($('#guide-chat-input').value); }
  });
  on($('#guide-chat-clear'), 'click', clearGuideChat);
}

/* =========================================================
   LIBRARY (fallacy glossary)
   ========================================================= */
function renderLibraryCards(list) {
  $('#library-grid').innerHTML = list.map((f) => `
    <article class="fallacy-card glass">
      <div class="fallacy-card-head"><h4 class="fallacy-card-name">${escapeHtml(f.name)}</h4><span class="fallacy-card-category">${escapeHtml(f.category || '')}</span></div>
      <p class="fallacy-card-def">${escapeHtml(f.definition || '')}</p>
      ${f.example ? `<p class="fallacy-card-example">"${escapeHtml(f.example)}"</p>` : ''}
      ${f.fix ? `<p class="fallacy-card-fix"><i class="fa-solid fa-wrench"></i> ${escapeHtml(f.fix)}</p>` : ''}
    </article>`).join('');
}

async function renderLibraryView() {
  await FallacyDetector.load();
  renderLibraryCards(Podium.fallacies);
}

/* =========================================================
   BOOTSTRAP
   ========================================================= */
async function checkSharedLink() {
  const match = location.pathname.match(/^\/share\/([a-f0-9]+)$/i);
  if (!match) return false;
  try {
    const data = await fetch(`/api/share/${match[1]}`).then((r) => r.json());
    if (data.error) { toast(data.error, 'warn'); return false; }
    Podium.round = {
      id: match[1], style: data.style, formatDef: Podium.formats[data.style], motion: data.motion,
      seats: data.seats, transcript: [], scores: data.scores, critique: data.critique,
      videoNotes: {}, pendingVideoAnalyses: [], startedAt: Date.now(),
    };
    renderResults();
    showRawView('results');
    toast('Viewing a shared round.');
    return true;
  } catch (err) { return false; }
}

function initShortcuts() {
  on($('#btn-shortcuts'), 'click', () => openModal('shortcuts-modal'));
  on($('#btn-close-shortcuts'), 'click', () => closeModal('shortcuts-modal'));
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      $('#shortcuts-modal').hidden ? openModal('shortcuts-modal') : closeModal('shortcuts-modal');
    }
    if (e.key === 'Escape') { $$('.modal-overlay').forEach((m) => { if (!m.hidden) m.hidden = true; }); }
  });
}

function initResultsAndCritiqueButtons() {
  on($('#btn-goto-critique'), 'click', goToCritique);
  on($('#btn-export-txt'), 'click', exportTranscript);
  on($('#btn-print'), 'click', () => window.print());
  on($('#btn-share'), 'click', shareResult);
  on($('#btn-new-debate'), 'click', resetToSetup);
  on($('#btn-new-debate-2'), 'click', resetToSetup);
  on($('#btn-back-to-results'), 'click', () => showRawView('results'));
}

function initTabsAndFilters() {
  $$('.tab').forEach((t) => on(t, 'click', () => switchView(t.dataset.view)));
  on($('#history-filter-style'), 'change', renderHistoryView);
  on($('#history-filter-sort'), 'change', renderHistoryView);
  on($('#library-search'), 'input', async (e) => {
    await FallacyDetector.load();
    const q = e.target.value.toLowerCase();
    renderLibraryCards(Podium.fallacies.filter((f) => f.name.toLowerCase().includes(q) || (f.category || '').toLowerCase().includes(q)));
  });
}

async function init() {
  initTheme();
  showLoading('Setting up the podium…', 'Loading formats and the fallacy library');
  try {
    Podium.formats = await Api.formats();
  } catch (err) {
    hideLoading();
    toast('Could not reach the server — is it running?', 'error');
    return;
  }
  FallacyDetector.load().catch(() => {});
  Api.health().then((h) => { Podium.hasApiKey = h.hasApiKey; $('#key-warning').hidden = !!h.hasApiKey; }).catch(() => {});

  initWizard();
  initComposer();
  initShortcuts();
  initResultsAndCritiqueButtons();
  initTabsAndFilters();
  initChrome();
  initGuide();

  const wasShared = await checkSharedLink();
  if (!wasShared) switchView('setup');
  hideLoading();
}

function initChrome() {
  const footerYear = $('#footer-year');
  if (footerYear) footerYear.textContent = `© ${new Date().getFullYear()}`;
  const topbar = $('.topbar');
  on(window, 'scroll', () => topbar.classList.toggle('is-scrolled', window.scrollY > 8));
}

document.addEventListener('DOMContentLoaded', init);
