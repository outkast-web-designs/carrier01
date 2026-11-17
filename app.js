'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('carrier.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('carrier.' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
    del(k) { try { localStorage.removeItem('carrier.' + k); } catch (e) { /* ignore */ } }
  };
  const TITLES = { today: 'Today', campaigns: 'Campaigns', replies: 'Replies', tenders: 'Tenders', more: 'More' };
  let tab = ls.get('tab', 'today');
  let busy = false;
  let installEvt = null;

  /* ---------- talking to the sender ---------- */
  async function call(action, payload) {
    const cfg = ls.get('cfg');
    if (!cfg || !cfg.u) throw new Error('Not connected yet.');
    let relayErrors = {};
    for (let round = 0; round < 5; round++) {
      let res;
      try {
        res = await fetch(cfg.u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ secret: cfg.s, action, relay: true }, payload || {}, { relayResults: {}, relayErrors, relayNotes: {} })) });
      } catch (e) { throw new Error('Could not reach your sender. Check your internet.'); }
      let j;
      try { j = JSON.parse(await res.text()); } catch (e) { throw new Error('Your sender did not answer. Check it is deployed with access set to Anyone.'); }
      if (!j.ok && j.relay) { relayErrors = Object.assign({}, relayErrors, { [j.relay.provider]: 'Not available on the phone app.' }); continue; }
      if (!j.ok) throw new Error(j.error || 'The sender returned an error.');
      return j.data;
    }
    throw new Error('The AI service needed for this is not available on the phone app yet.');
  }

  /* ---------- small helpers ---------- */
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2800); }
  function ago(ms) {
    if (!ms) return '';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function until(ms) {
    const m = Math.round((ms - Date.now()) / 60000);
    if (m <= 0) return 'any moment'; if (m < 60) return 'in about ' + m + ' min'; return 'in about ' + Math.round(m / 60) + ' h';
  }
  const gbp = (n) => (n == null || n === '' ? '' : '£' + Number(n).toLocaleString('en-GB'));
  const shortDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const loading = (t) => '<div class="empty"><span class="spin"></span><div>' + esc(t || 'Loading…') + '</div></div>';
  const errBox = (e) => '<div class="banner bad">' + esc(e.message || e) + '</div>';

  /* ---------- connect ---------- */
  function readConnectLink() {
    const m = /[#&]connect=([^&]+)/.exec(location.hash || '');
    if (!m) return false;
    try {
      const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const o = JSON.parse(decodeURIComponent(escape(atob(b + '==='.slice((b.length + 3) % 4)))));
      if (/^https:\/\/script\.google\.com\/.+\/exec$/.test(o.u) && o.s) { ls.set('cfg', { u: o.u, s: o.s }); history.replaceState(null, '', location.pathname + location.search); return true; }
    } catch (e) { /* fall through */ }
    return false;
  }
  function viewSetup() {
    $('#main').innerHTML = '<div class="card"><h2>Connect your sender</h2><p class="muted">On your computer, open Carrier, go to the <b>Sender</b> tab, find <b>Use Carrier on your phone</b>, and copy your phone link. Send it to yourself and open it here, or paste it below.</p>' +
      '<label class="field">Phone link<textarea id="linkIn" placeholder="https://…#connect=…" spellcheck="false" rows="3"></textarea></label><button class="btn primary block" id="linkGo" type="button">Connect</button><p class="muted" id="linkMsg"></p></div>';
    $('#linkGo').onclick = () => {
      const v = $('#linkIn').value.trim(); const i = v.indexOf('#');
      if (i < 0) { $('#linkMsg').textContent = 'That does not look like a phone link. It should contain #connect=.'; return; }
      location.hash = v.slice(i);
      if (readConnectLink()) { toast('Connected.'); go('today'); } else $('#linkMsg').textContent = 'That link could not be read. Copy it again from Carrier on your computer.';
    };
  }

  /* ---------- TODAY ---------- */
  async function viewToday(force) {
    const cached = ls.get('status');
    if (cached) paintToday(cached, true);
    else $('#main').innerHTML = loading('Asking your sender…');
    try {
      const s = await call('status');
      ls.set('status', Object.assign({ at: Date.now() }, s));
      if (tab === 'today') paintToday(ls.get('status'), false);
      dot(s);
    } catch (e) { if (!cached && tab === 'today') $('#main').innerHTML = errBox(e) + '<button class="btn block" id="retry" type="button">Try again</button>'; else if (force) toast(e.message); const r = $('#retry'); if (r) r.onclick = () => viewToday(true); }
  }
  function dot(s) { $('#repDot').hidden = !(s && s.warm > 0); }
  function paintToday(s, stale) {
    const cap = Number(s.effectiveCap) || (s.settings && s.settings.dailyCap) || 0;
    const sent = s.sentToday || 0;
    const pct = cap ? Math.min(100, Math.round((sent / cap) * 100)) : 0;
    const cs = s.campaigns || [];
    const active = cs.filter((c) => c.status === 'active');
    const replied = cs.reduce((n, c) => n + ((c.counts && c.counts.replied) || 0), 0);
    let state = '';
    if (s.blockedUntil && s.blockedUntil > Date.now()) state = 'Paused by Google until ' + new Date(s.blockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    else if (!active.length) state = 'No campaign is running';
    else if (!s.inWindow) state = 'Outside your sending hours';
    else if (s.nextSendAt) state = 'Next email ' + until(s.nextSendAt);
    const notices = (s.notices || []).slice().reverse();
    $('#main').innerHTML =
      (stale ? '' : '') +
      ((s.version || 0) < 12 ? '<div class="banner">Your sender code is older than this app. Tenders here need the newest sender code: on your computer open Carrier, Sender tab, Copy sender code, paste it into Apps Script, run <b>setup</b>, then Deploy a new version.</div>' : '') +
      '<div class="card hero"><div class="sub">Sent today</div><div class="big">' + sent + (cap ? '<span style="font-size:20px;font-weight:600;opacity:.8"> of ' + cap + '</span>' : '') + '</div><div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div><div class="sub" style="margin-top:10px">' + esc(state) + '</div></div>' +
      '<div class="tiles"><div class="tile"><b>' + (s.warm || 0) + '</b><span>Interested</span></div><div class="tile"><b>' + replied + '</b><span>Replies</span></div><div class="tile"><b>' + (s.waiting || 0) + '</b><span>Waiting to send</span></div></div>' +
      '<div class="row" style="margin-bottom:12px"><button class="btn block" id="chk" type="button">Check for replies now</button></div>' +
      (s.lastReplyCheck ? '<p class="muted" style="margin:-4px 4px 12px">Last checked ' + esc(ago(s.lastReplyCheck)) + '.</p>' : '') +
      (notices.length ? '<h2 class="sec">Needs attention</h2>' + notices.slice(0, 4).map((n) => '<div class="banner' + (n.kind === 'error' ? ' bad' : '') + '"><div>' + esc(n.text) + '</div><div class="row" style="margin-top:8px"><button class="btn" data-dismiss="' + esc(n.id) + '" type="button">Dismiss</button></div></div>').join('') : '') +
      '<h2 class="sec">Running now</h2>' +
      (active.length ? active.slice(0, 4).map(campCard).join('') : '<div class="empty"><b>Nothing running</b>Start a campaign from Carrier on your computer. This app will show it here.</div>');
    const chk = $('#chk'); if (chk) chk.onclick = async () => { chk.disabled = true; chk.textContent = 'Checking…'; try { await call('checkReplies'); toast('Checked.'); } catch (e) { toast(e.message); } viewToday(true); };
    document.querySelectorAll('[data-dismiss]').forEach((b) => { b.onclick = async () => { b.disabled = true; try { await call('dismissNotices', { id: b.dataset.dismiss }); } catch (e) { toast(e.message); } viewToday(true); }; });
    bindCampButtons();
  }

  /* ---------- CAMPAIGNS ---------- */
  function campCard(c) {
    const k = c.counts || {}; const total = k.total || 0;
    const done = total - (k.queued || 0);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const st = c.status === 'active' ? '<span class="tag ok">Running</span>' : c.status === 'paused' ? '<span class="tag warn">Paused</span>' : '<span class="tag">' + esc(c.status) + '</span>';
    return '<div class="card item"><div class="row" style="justify-content:space-between"><h3>' + esc(c.name) + '</h3>' + st + '</div>' +
      '<div class="meta">' + esc(c.service || '') + (c.unique ? ' · different email per business' : '') + '</div>' +
      '<div class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
      '<div class="meta" style="margin-top:8px">' + done + ' of ' + total + ' contacted · ' + (k.replied || 0) + ' replied' + (k.bounced ? ' · ' + k.bounced + ' bounced' : '') + (k.optout ? ' · ' + k.optout + ' opted out' : '') + '</div>' +
      (c.status === 'active' || c.status === 'paused' ? '<button class="btn" data-camp="' + esc(c.id) + '" data-to="' + (c.status === 'active' ? 'paused' : 'active') + '" type="button">' + (c.status === 'active' ? 'Pause' : 'Resume') + '</button>' : '') + '</div>';
  }
  function bindCampButtons() {
    document.querySelectorAll('[data-camp]').forEach((b) => { b.onclick = async () => { b.disabled = true; try { const s = await call('setCampaign', { id: b.dataset.camp, status: b.dataset.to }); ls.set('status', Object.assign({ at: Date.now() }, s)); toast(b.dataset.to === 'paused' ? 'Paused.' : 'Resumed.'); } catch (e) { toast(e.message); } render(); }; });
  }
  async function viewCampaigns() {
    const cached = ls.get('status');
    const paint = (s) => { const cs = s.campaigns || []; $('#main').innerHTML = cs.length ? cs.slice().reverse().map(campCard).join('') : '<div class="empty"><b>No campaigns yet</b>Create one in Carrier on your computer and it appears here.</div>'; bindCampButtons(); };
    if (cached) paint(cached); else $('#main').innerHTML = loading();
    try { const s = await call('status'); ls.set('status', Object.assign({ at: Date.now() }, s)); if (tab === 'campaigns') paint(s); dot(s); } catch (e) { if (!cached) $('#main').innerHTML = errBox(e); }
  }

  /* ---------- REPLIES ---------- */
  const TYPES = { interested: ['ok', 'Interested'], question: ['', 'Question'], notnow: ['warn', 'Not now'], unsub: ['bad', 'Stop'], ooo: ['', 'Out of office'] };
  async function viewReplies() {
    const cached = ls.get('replies');
    const paint = (r) => {
      const items = r.items || [];
      $('#main').innerHTML = items.length ? items.map((x, i) => { const t = TYPES[x.replyType] || ['', x.replyType || 'Reply']; return '<div class="card item" data-i="' + i + '"><div class="row" style="justify-content:space-between"><h3>' + esc(x.company || x.email) + '</h3><span class="tag ' + t[0] + '">' + esc(t[1]) + '</span></div><div class="meta">' + esc(x.email) + ' · ' + esc(ago(x.repliedAt)) + (x.campaign ? ' · ' + esc(x.campaign) : '') + '</div><div class="snip">' + esc(x.snippet) + '</div>' + (x.kind === 'stop' ? '' : '<button class="btn primary" data-reply="' + i + '" type="button">Reply</button>') + '<div class="rbox" data-box="' + i + '"></div></div>'; }).join('') : '<div class="empty"><b>No replies yet</b>When someone replies they show up here.</div>';
      document.querySelectorAll('[data-reply]').forEach((b) => { b.onclick = () => openReply(items[Number(b.dataset.reply)], b.dataset.reply, b); });
    };
    if (cached) paint(cached); else $('#main').innerHTML = loading('Reading your replies…');
    try { const r = await call('replies'); ls.set('replies', r); if (tab === 'replies') paint(r); } catch (e) { if (!cached) $('#main').innerHTML = errBox(e); else toast(e.message); }
  }
  function openReply(item, i, btn) {
    const box = document.querySelector('[data-box="' + i + '"]');
    btn.hidden = true;
    box.innerHTML = '<label class="field" style="margin-top:8px">Your reply<textarea id="rt' + i + '" placeholder="Write your reply…"></textarea></label><div class="row"><button class="btn primary" id="rs' + i + '" type="button">Send</button><button class="btn" id="rd' + i + '" type="button">Save as draft</button><button class="btn" id="rc' + i + '" type="button">Cancel</button></div>';
    const text = () => $('#rt' + i).value.trim();
    const send = (asDraft) => async () => { if (!text()) { toast('Write a reply first.'); return; } $('#rs' + i).disabled = $('#rd' + i).disabled = true; try { await call('sendMessage', { id: item.id, text: text(), asDraft }); toast(asDraft ? 'Saved to your Gmail drafts.' : 'Sent.'); box.innerHTML = '<p class="muted">' + (asDraft ? 'Saved as a draft in Gmail.' : 'Sent.') + '</p>'; } catch (e) { toast(e.message); $('#rs' + i).disabled = $('#rd' + i).disabled = false; } };
    $('#rs' + i).onclick = send(false); $('#rd' + i).onclick = send(true);
    $('#rc' + i).onclick = () => { box.innerHTML = ''; btn.hidden = false; };
    $('#rt' + i).focus();
  }

  /* ---------- TENDERS ---------- */
  function viewTenders() {
    const searches = ls.get('searches', []);
    const res = ls.get('tenders', { at: 0, list: [] });
    const seen = new Set(ls.get('seen', []));
    $('#main').innerHTML =
      '<div class="card"><h2>Your searches</h2>' + (searches.length ? searches.map((s, i) => '<div class="list-row"><div class="grow"><b>' + esc(s.name) + '</b><div class="muted">' + esc([s.keywords && 'for ' + s.keywords, s.region, s.kind !== 'all' ? (s.kind === 'dps' ? 'DPS only' : 'tenders only') : '', s.minValue ? 'from £' + s.minValue : ''].filter(Boolean).join(' · ')) + '</div></div><button class="btn" data-del="' + i + '" type="button">Remove</button></div>').join('') : '<p class="muted">No searches yet. Add one below, for example the trade you write tenders for.</p>') +
      '<details style="margin-top:10px"' + (searches.length ? '' : ' open') + '><summary class="btn" style="display:flex;align-items:center;list-style:none">Add a search</summary><div style="margin-top:12px">' +
      '<label class="field">Name<input id="tnName" placeholder="Building repairs"></label><label class="field">Keywords (any of, separated by commas)<input id="tnKw" placeholder="repairs, voids, maintenance"></label><label class="field">Leave out<input id="tnEx" placeholder="plumbing"></label><label class="field">Region or town<input id="tnReg" placeholder="Manchester"></label><label class="field">Show<select id="tnKind"><option value="all">Tenders and DPS</option><option value="tender">Tenders only</option><option value="dps">DPS only</option></select></label><button class="btn primary block" id="tnAdd" type="button">Save search</button></div></details></div>' +
      '<button class="btn primary block" id="tnCheck" type="button" style="margin-bottom:12px">Check for new tenders</button><div id="tnOut"></div>';
    $('#tnOut').innerHTML = res.list.length ? '<p class="muted" style="margin:0 4px 10px">Last checked ' + esc(ago(res.at)) + ' · ' + res.list.length + ' match' + (res.list.length === 1 ? '' : 'es') + '</p>' + res.list.map((n, i) => tenderCard(n, i, seen)).join('') : '';
    $('#tnAdd').onclick = () => { const s = { name: $('#tnName').value.trim() || $('#tnKw').value.trim(), keywords: $('#tnKw').value.trim(), exclude: $('#tnEx').value.trim(), region: $('#tnReg').value.trim(), kind: $('#tnKind').value, minValue: 0, maxValue: 0 }; if (!s.keywords && !s.region) { toast('Add a keyword or a region.'); return; } if (searches.length >= 12) { toast('Up to 12 searches.'); return; } searches.push(s); ls.set('searches', searches); viewTenders(); toast('Saved.'); };
    document.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { searches.splice(Number(b.dataset.del), 1); ls.set('searches', searches); viewTenders(); }; });
    $('#tnCheck').onclick = async () => {
      if (!searches.length) { toast('Save a search first.'); return; }
      const btn = $('#tnCheck'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Looking… this can take up to a minute';
      try {
        const r = await call('tenderSearch', { searches, days: 3 });
        const prev = new Set(ls.get('seen', []));
        const list = r.notices.map((n) => Object.assign(n, { isNew: !prev.has(n.id) }));
        r.notices.forEach((n) => prev.add(n.id)); ls.set('seen', Array.from(prev).slice(-1500));
        ls.set('tenders', { at: Date.now(), list, notes: r.notes });
        viewTenders();
        const notes = (r.notes || []).join(' ');
        toast(notes ? notes : r.notices.length + ' match' + (r.notices.length === 1 ? '' : 'es') + ' from ' + r.checked + ' notices.');
      } catch (e) { toast(/Unknown action/.test(e.message) ? 'Update your sender code first (see Today).' : e.message); btn.disabled = false; btn.textContent = 'Check for new tenders'; }
    };
    document.querySelectorAll('[data-share]').forEach((b) => { b.onclick = async () => { const n = res.list[Number(b.dataset.share)]; try { if (navigator.share) await navigator.share({ title: n.title, url: n.url }); else { await navigator.clipboard.writeText(n.url); toast('Link copied.'); } } catch (e) { /* cancelled */ } }; });
  }
  function tenderCard(n, i) {
    return '<div class="card item"><h3>' + esc(n.title || 'Untitled') + (n.isNew ? ' <span class="tag ok">New</span>' : '') + (n.type === 'dps' ? ' <span class="tag">DPS</span>' : '') + '</h3><div class="meta">' + esc([n.buyer, n.amount != null ? gbp(n.amount) : '', n.deadline ? 'Closes ' + shortDate(n.deadline) : '', n.location].filter(Boolean).join(' · ')) + '</div>' +
      (n.scope ? '<div class="snip muted">' + esc(n.scope.slice(0, 200)) + (n.scope.length > 200 ? '…' : '') + '</div>' : '') +
      '<div class="row">' + (n.url ? '<a class="btn link-btn" href="' + esc(n.url) + '" target="_blank" rel="noopener">Open notice</a><button class="btn" data-share="' + i + '" type="button">Share</button>' : '') + '</div></div>';
  }

  /* ---------- MORE ---------- */
  function viewMore() {
    const s = ls.get('status') || {};
    $('#main').innerHTML =
      '<div class="card"><h2>Connected account</h2><p style="margin:0">' + esc(s.account || 'Not checked yet') + '</p>' + (s.sheetUrl ? '<p class="muted"><a href="' + esc(s.sheetUrl) + '" target="_blank" rel="noopener">Open your Google Sheet</a></p>' : '') + '<p class="muted">Sender version ' + esc(s.version || '?') + '</p></div>' +
      (installEvt ? '<button class="btn primary block" id="inst" type="button" style="margin-bottom:12px">Add Carrier to my home screen</button>' : '<div class="card"><h2>Install</h2><p class="muted" style="margin:0">In Chrome, open the menu (three dots) and choose <b>Add to Home screen</b> or <b>Install app</b>.</p></div>') +
      '<div class="card"><h2>Coming next</h2><p class="muted" style="margin:0">Finding leads and writing emails from your phone. For now, create campaigns on your computer; this app shows progress, replies and tenders.</p></div>' +
      '<button class="btn block" id="disc" type="button">Disconnect this phone</button>';
    const i = $('#inst'); if (i) i.onclick = async () => { installEvt.prompt(); installEvt = null; };
    $('#disc').onclick = () => { if (confirm('Disconnect this phone from your sender? Your campaigns are not affected.')) { ['cfg', 'status', 'replies', 'tenders', 'seen'].forEach(ls.del); render(); } };
  }

  /* ---------- shell ---------- */
  function go(t) { tab = t; ls.set('tab', t); render(); window.scrollTo(0, 0); }
  function render() {
    $('#pageTitle').textContent = TITLES[tab] || 'Carrier';
    document.querySelectorAll('#tabs button').forEach((b) => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (!ls.get('cfg')) { $('#pageTitle').textContent = 'Carrier'; viewSetup(); return; }
    ({ today: viewToday, campaigns: viewCampaigns, replies: viewReplies, tenders: viewTenders, more: viewMore }[tab] || viewToday)();
  }
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
  $('#refresh').onclick = () => { if (busy) return; render(); toast('Refreshing…'); };
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
  window.addEventListener('hashchange', () => { if (readConnectLink()) render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ls.get('cfg') && (tab === 'today' || tab === 'replies')) render(); });
  readConnectLink();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { /* app still works */ });
  render();
})();
