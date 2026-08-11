// Serves the CRM dashboard as a single self-contained HTML page (inline CSS
// + vanilla JS, no build step). The page itself is public — every actual
// piece of data is behind the auth-gated /api/dashboard/* endpoints, so an
// unauthenticated visitor sees only an empty shell + login form.
export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(PAGE);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>GemHub CRM</title>
<style>
:root{
  --wa-header:#008069; --wa-header-dark:#005c4b;
  --wa-bg:#f0f2f5; --wa-panel:#ffffff; --wa-chat-bg:#efeae2;
  --wa-in:#ffffff; --wa-out:#d9fdd3; --wa-text:#111b21; --wa-sub:#667781;
  --wa-border:#e9edef; --wa-green:#25d366; --wa-danger:#e35b5b;
  --wa-chip:#f0f2f5; --wa-accent:#008069;
}
@media (prefers-color-scheme: dark){
  :root{
    --wa-header:#202c33; --wa-header-dark:#111b21;
    --wa-bg:#111b21; --wa-panel:#202c33; --wa-chat-bg:#0b141a;
    --wa-in:#202c33; --wa-out:#005c4b; --wa-text:#e9edef; --wa-sub:#8696a0;
    --wa-border:#2a3942; --wa-green:#25d366; --wa-danger:#f2867e;
    --wa-chip:#2a3942; --wa-accent:#00a884;
  }
}
*{box-sizing:border-box;}
html,body{height:100%;margin:0;}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
  background:var(--wa-bg); color:var(--wa-text); overflow:hidden;
}
#app{display:flex; height:100vh; width:100vw;}
.hidden{display:none !important;}

/* ---- Login screen ---- */
#loginScreen{
  position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
  background:var(--wa-bg); z-index:50;
}
#loginBox{
  background:var(--wa-panel); padding:32px 28px; border-radius:12px; width:300px;
  box-shadow:0 2px 12px rgba(0,0,0,.15); text-align:center;
}
#loginBox h1{font-size:20px; margin:0 0 4px; color:var(--wa-accent);}
#loginBox p{font-size:13px; color:var(--wa-sub); margin:0 0 20px;}
#loginBox input{
  width:100%; padding:11px 12px; border:1px solid var(--wa-border); border-radius:8px;
  font-size:14px; background:var(--wa-bg); color:var(--wa-text); margin-bottom:10px;
}
#loginBox button{
  width:100%; padding:11px; border:none; border-radius:8px; background:var(--wa-accent);
  color:#fff; font-size:14px; font-weight:600; cursor:pointer;
}
#loginBox button:disabled{opacity:.6; cursor:default;}
#loginError{color:var(--wa-danger); font-size:12px; min-height:16px; margin-top:8px;}

/* ---- Sidebar ---- */
#sidebar{
  width:380px; min-width:300px; max-width:420px; display:flex; flex-direction:column;
  background:var(--wa-panel); border-right:1px solid var(--wa-border);
}
#sidebarHeader{
  background:var(--wa-header); color:#fff; padding:14px 16px; display:flex;
  align-items:center; justify-content:space-between; flex-shrink:0;
}
#sidebarHeader h1{font-size:17px; margin:0; font-weight:600;}
#logoutBtn{background:none; border:none; color:#fff; opacity:.85; cursor:pointer; font-size:13px;}
#searchWrap{padding:8px 12px; flex-shrink:0;}
#searchInput{
  width:100%; padding:9px 14px; border-radius:20px; border:none; background:var(--wa-chip);
  color:var(--wa-text); font-size:14px;
}
#filterRow{display:flex; gap:6px; padding:0 12px 10px; flex-wrap:wrap; flex-shrink:0;}
.chip{
  padding:6px 12px; border-radius:16px; background:var(--wa-chip); border:none; cursor:pointer;
  font-size:12.5px; color:var(--wa-sub); white-space:nowrap;
}
.chip.active{background:var(--wa-accent); color:#fff;}
#convList{overflow-y:auto; flex:1;}
.convItem{
  display:flex; gap:12px; padding:12px 16px; cursor:pointer; border-bottom:1px solid var(--wa-border);
  align-items:flex-start;
}
.convItem:hover{background:var(--wa-bg);}
.convItem.selected{background:var(--wa-chip);}
.avatar{
  width:44px; height:44px; border-radius:50%; background:var(--wa-accent); color:#fff;
  display:flex; align-items:center; justify-content:center; font-weight:600; flex-shrink:0; font-size:16px;
}
.convMain{flex:1; min-width:0;}
.convTop{display:flex; justify-content:space-between; align-items:baseline; gap:6px;}
.convName{font-size:14.5px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.convTime{font-size:11.5px; color:var(--wa-sub); flex-shrink:0;}
.convBottom{display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:2px;}
.convPreview{font-size:13px; color:var(--wa-sub); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;}
.badges{display:flex; gap:4px; align-items:center; flex-shrink:0;}
.badge{font-size:10px; padding:1px 5px; border-radius:8px; background:var(--wa-chip); color:var(--wa-sub);}
.badge.off{background:var(--wa-danger); color:#fff;}
.unreadDot{
  background:var(--wa-green); color:#fff; border-radius:10px; min-width:18px; height:18px;
  font-size:11px; display:flex; align-items:center; justify-content:center; padding:0 5px; font-weight:600;
}
#emptyList{padding:30px 20px; text-align:center; color:var(--wa-sub); font-size:13px;}

/* ---- Main / thread pane ---- */
#main{flex:1; display:flex; flex-direction:column; min-width:0;}
#emptyState{
  flex:1; display:flex; align-items:center; justify-content:center; flex-direction:column;
  color:var(--wa-sub); background:var(--wa-chat-bg);
}
#emptyState .icon{font-size:56px; margin-bottom:10px;}
#threadView{flex:1; display:flex; flex-direction:column; min-height:0;}
#threadHeader{
  background:var(--wa-panel); border-bottom:1px solid var(--wa-border); padding:10px 16px;
  display:flex; align-items:center; gap:12px; flex-shrink:0;
}
#backBtn{display:none; background:none; border:none; font-size:20px; cursor:pointer; color:var(--wa-text);}
#threadHeaderMain{flex:1; min-width:0;}
#threadName{font-size:15px; font-weight:600;}
#threadSub{font-size:12px; color:var(--wa-sub); margin-top:1px;}
#botToggleWrap{display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--wa-sub); flex-shrink:0;}
.switch{position:relative; width:38px; height:22px; flex-shrink:0;}
.switch input{opacity:0; width:0; height:0;}
.slider{
  position:absolute; cursor:pointer; inset:0; background:#ccc; border-radius:22px; transition:.15s;
}
.slider:before{
  content:""; position:absolute; height:16px; width:16px; left:3px; bottom:3px;
  background:#fff; border-radius:50%; transition:.15s;
}
input:checked + .slider{background:var(--wa-green);}
input:checked + .slider:before{transform:translateX(16px);}
#infoBar{display:flex; gap:8px; padding:8px 16px; flex-wrap:wrap; background:var(--wa-panel); border-bottom:1px solid var(--wa-border);}
.infoChip{font-size:11.5px; padding:3px 9px; border-radius:12px; background:var(--wa-chip); color:var(--wa-sub);}
.infoChip.stage{background:var(--wa-accent); color:#fff;}
.infoChip.objection{background:#f5c04a; color:#4d3800;}
#messages{flex:1; overflow-y:auto; padding:16px 6%; background:var(--wa-chat-bg); display:flex; flex-direction:column; gap:3px;}
.bubbleRow{display:flex;}
.bubbleRow.out{justify-content:flex-end;}
.bubbleRow.in{justify-content:flex-start;}
.bubbleRow.system{justify-content:center;}
.bubble{
  max-width:65%; padding:7px 10px; border-radius:8px; font-size:14px; line-height:1.4;
  box-shadow:0 1px 1px rgba(0,0,0,.08); position:relative; word-wrap:break-word;
}
.bubble.out{background:var(--wa-out);}
.bubble.in{background:var(--wa-in);}
.bubble.system{background:var(--wa-chip); color:var(--wa-sub); font-size:12.5px; max-width:80%; text-align:center; border-radius:8px;}
.bubble img{max-width:100%; border-radius:6px; display:block; margin-bottom:4px;}
.bubble .msgTime{font-size:10.5px; color:var(--wa-sub); text-align:right; margin-top:3px;}
.bubble .tag{font-size:10px; opacity:.7; margin-bottom:2px; font-weight:600;}
.chips-inline{display:flex; flex-wrap:wrap; gap:5px; margin-top:6px;}
.chip-inline{font-size:11.5px; padding:4px 9px; border:1px solid rgba(0,0,0,.15); border-radius:14px; background:rgba(255,255,255,.4);}
.ctaLink{display:flex; align-items:center; gap:6px; margin-top:6px; padding:8px; background:rgba(0,0,0,.04); border-radius:6px; font-size:13px; color:var(--wa-accent);}
#replyBar{display:flex; align-items:flex-end; gap:8px; padding:10px 16px; background:var(--wa-panel); flex-shrink:0;}
#replyInput{
  flex:1; resize:none; border:none; border-radius:20px; padding:10px 16px; font-size:14px;
  background:var(--wa-chip); color:var(--wa-text); max-height:100px; font-family:inherit;
}
#sendBtn{
  width:42px; height:42px; border-radius:50%; border:none; background:var(--wa-accent); color:#fff;
  font-size:18px; cursor:pointer; flex-shrink:0;
}
#sendBtn:disabled{opacity:.5; cursor:default;}
#replyError{padding:0 16px 8px; font-size:12px; color:var(--wa-danger); background:var(--wa-panel);}

@media (max-width: 820px){
  #sidebar{width:100%; max-width:none;}
  #app.threadOpen #sidebar{display:none;}
  #app:not(.threadOpen) #main{display:none;}
  #backBtn{display:block;}
}
</style>
</head>
<body>
<div id="loginScreen">
  <div id="loginBox">
    <h1>GemHub CRM</h1>
    <p>Enter the dashboard password to continue</p>
    <input id="pwInput" type="password" placeholder="Password" autocomplete="current-password">
    <button id="loginBtn">Log in</button>
    <div id="loginError"></div>
  </div>
</div>

<div id="app">
  <div id="sidebar">
    <div id="sidebarHeader">
      <h1>GemHub CRM</h1>
      <a href="/campaigns" style="color:#fff;opacity:.85;font-size:12.5px;margin-right:12px;text-decoration:none;">Campaigns &#8594;</a>
      <button id="logoutBtn">Log out</button>
    </div>
    <div id="searchWrap"><input id="searchInput" placeholder="Search name, number or message..."></div>
    <div id="filterRow">
      <button class="chip active" data-filter="">All</button>
      <button class="chip" data-filter="unread">Unread</button>
      <button class="chip" data-filter="handed_over">Handed over</button>
      <button class="chip" data-filter="ad_sourced">Ad-sourced</button>
      <button class="chip" data-filter="campaign_sourced">Campaign</button>
      <button class="chip" data-filter="has_order">Has order</button>
    </div>
    <div id="convList"></div>
  </div>

  <div id="main">
    <div id="emptyState"><div class="icon">&#128172;</div><div>Select a conversation</div></div>
    <div id="threadView" class="hidden">
      <div id="threadHeader">
        <button id="backBtn">&#8592;</button>
        <div id="threadHeaderMain">
          <div id="threadName"></div>
          <div id="threadSub"></div>
        </div>
        <div id="botToggleWrap">
          <span id="botLabel">Bot ON</span>
          <label class="switch">
            <input type="checkbox" id="botToggle">
            <span class="slider"></span>
          </label>
        </div>
      </div>
      <div id="infoBar"></div>
      <div id="messages"></div>
      <div id="replyError" class="hidden"></div>
      <div id="replyBar">
        <textarea id="replyInput" rows="1" placeholder="Type a message..."></textarea>
        <button id="sendBtn">&#10148;</button>
      </div>
    </div>
  </div>
</div>

<script>
(function () {
  'use strict';

  var STAGE_LABELS = {
    greeted: 'Greeted', qualified: 'Qualified', shown_products: 'Shown products',
    booked: 'Booked visit', purchased: 'Purchased'
  };
  var FILTERS = ['', 'unread', 'handed_over', 'ad_sourced', 'campaign_sourced', 'has_order'];

  var state = {
    conversations: [],
    selectedPhone: null,
    thread: null,
    filter: '',
    query: '',
    listTimer: null,
    threadTimer: null,
    windowTickTimer: null
  };

  var el = {};
  ['loginScreen','loginBox','pwInput','loginBtn','loginError','app','sidebar','convList',
   'searchInput','filterRow','main','emptyState','threadView','threadName','threadSub',
   'botToggle','botLabel','infoBar','messages','replyInput','sendBtn','replyError',
   'backBtn','logoutBtn'].forEach(function (id) { el[id] = document.getElementById(id); });

  // ---- fetch helpers ----
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        return { ok: res.ok, status: res.status, json: json };
      });
    });
  }

  // ---- auth ----
  function tryLogin() {
    var pw = el.pwInput.value;
    if (!pw) return;
    el.loginBtn.disabled = true;
    el.loginError.textContent = '';
    api('/api/dashboard/login', { method: 'POST', body: { password: pw } }).then(function (r) {
      el.loginBtn.disabled = false;
      if (r.ok) {
        el.loginScreen.classList.add('hidden');
        boot();
      } else {
        el.loginError.textContent = r.json.error || 'Login failed';
      }
    });
  }
  el.loginBtn.addEventListener('click', tryLogin);
  el.pwInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });
  el.logoutBtn.addEventListener('click', function () {
    api('/api/dashboard/logout', { method: 'POST' }).then(function () { window.location.reload(); });
  });

  // ---- formatting ----
  function initials(name, phone) {
    var s = (name && name !== 'there' ? name : phone || '?').trim();
    var parts = s.split(/\\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function linkify(html) {
    return html.replace(/(https?:\\/\\/[^\\s<]+)/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">' + u + '</a>';
    });
  }
  function relTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var diff = Date.now() - ms;
    var min = Math.floor(diff / 60000);
    if (min < 1) return 'now';
    if (min < 60) return min + 'm';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h';
    var day = Math.floor(hr / 24);
    if (day < 7) return day + 'd';
    return d.toLocaleDateString();
  }
  function timeOfDay(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  function fmtWindow(open, secs) {
    if (!open) return 'Window closed \\u2014 template required';
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    return 'Window open \\u2014 ' + h + 'h ' + m + 'm left';
  }

  // ---- conversation list ----
  function loadConversations() {
    var params = [];
    if (state.query) params.push('q=' + encodeURIComponent(state.query));
    if (state.filter) params.push('filter=' + encodeURIComponent(state.filter));
    var qs = params.length ? '?' + params.join('&') : '';
    api('/api/dashboard/conversations' + qs).then(function (r) {
      if (r.status === 401) return showLogin();
      if (!r.ok) return;
      state.conversations = r.json.conversations || [];
      renderList();
    });
  }

  function renderList() {
    if (!state.conversations.length) {
      el.convList.innerHTML = '<div id="emptyList">No conversations yet.</div>';
      return;
    }
    var html = state.conversations.map(function (c) {
      var name = c.name && c.name !== 'there' ? c.name : c.phone;
      var badges = '';
      if (!c.botOn) badges += '<span class="badge off">Handed over</span>';
      if (c.adSourced) badges += '<span class="badge">Ad</span>';
      if (c.hasOrder) badges += '<span class="badge">Order</span>';
      var unread = c.unreadCount > 0 ? '<span class="unreadDot">' + (c.unreadCount > 99 ? '99+' : c.unreadCount) + '</span>' : '';
      return '' +
        '<div class="convItem' + (c.phone === state.selectedPhone ? ' selected' : '') + '" data-phone="' + c.phone + '">' +
          '<div class="avatar">' + initials(c.name, c.phone) + '</div>' +
          '<div class="convMain">' +
            '<div class="convTop"><div class="convName">' + escapeHtml(name) + '</div>' +
            '<div class="convTime">' + relTime(c.lastAt) + '</div></div>' +
            '<div class="convBottom"><div class="convPreview">' + escapeHtml(c.lastPreview || '') + '</div>' +
            '<div class="badges">' + badges + unread + '</div></div>' +
          '</div>' +
        '</div>';
    }).join('');
    el.convList.innerHTML = html;
    Array.prototype.forEach.call(el.convList.querySelectorAll('.convItem'), function (node) {
      node.addEventListener('click', function () { selectConversation(node.getAttribute('data-phone')); });
    });
  }

  el.filterRow.addEventListener('click', function (e) {
    var btn = e.target.closest('.chip');
    if (!btn) return;
    state.filter = btn.getAttribute('data-filter') || '';
    Array.prototype.forEach.call(el.filterRow.querySelectorAll('.chip'), function (c) { c.classList.remove('active'); });
    btn.classList.add('active');
    loadConversations();
  });

  var searchDebounce = null;
  el.searchInput.addEventListener('input', function () {
    clearTimeout(searchDebounce);
    var val = el.searchInput.value;
    searchDebounce = setTimeout(function () { state.query = val; loadConversations(); }, 350);
  });

  // ---- thread ----
  function selectConversation(phone) {
    state.selectedPhone = phone;
    el.app.classList.add('threadOpen');
    el.emptyState.classList.add('hidden');
    el.threadView.classList.remove('hidden');
    renderList();
    loadThread(true);
    clearInterval(state.threadTimer);
    state.threadTimer = setInterval(function () { loadThread(false); }, 4000);
  }

  el.backBtn.addEventListener('click', function () {
    el.app.classList.remove('threadOpen');
    clearInterval(state.threadTimer);
  });

  function loadThread(scrollToBottom) {
    if (!state.selectedPhone) return;
    api('/api/dashboard/thread?phone=' + encodeURIComponent(state.selectedPhone)).then(function (r) {
      if (r.status === 401) return showLogin();
      if (!r.ok) return;
      state.thread = r.json.conversation;
      renderThread(scrollToBottom);
      // reflect unread-cleared + any preview change in the list without a full reload
      var item = state.conversations.find(function (c) { return c.phone === state.thread.phone; });
      if (item) { item.unreadCount = 0; }
    });
  }

  function renderThread(scrollToBottom) {
    var t = state.thread;
    if (!t) return;
    var name = t.name && t.name !== 'there' ? t.name : t.phone;
    el.threadName.textContent = name;
    el.threadSub.textContent = t.phone + '  \\u00b7  ' + fmtWindow(t.windowOpen, t.windowTtlSeconds);
    el.botToggle.checked = t.botOn;
    el.botLabel.textContent = t.botOn ? 'Bot ON' : 'Bot OFF';

    var chips = '<span class="infoChip stage">' + (STAGE_LABELS[t.stage] || t.stage) + '</span>';
    if (t.leadOccasion) chips += '<span class="infoChip">Occasion: ' + escapeHtml(t.leadOccasion) + '</span>';
    if (t.leadBudget) chips += '<span class="infoChip">Budget: ' + escapeHtml(t.leadBudget) + '</span>';
    if (t.hasObjection) chips += '<span class="infoChip objection">Objection raised</span>';
    if (t.adSourced) chips += '<span class="infoChip">Ad-sourced</span>';
    if (t.campaignSource) chips += '<span class="infoChip" title="' + escapeHtml(t.campaignOffer || '') + '">Campaign reply</span>';
    if (t.hasOrder) chips += '<span class="infoChip">Has order</span>';
    el.infoBar.innerHTML = chips;

    var atBottom = el.messages.scrollTop + el.messages.clientHeight >= el.messages.scrollHeight - 40;
    el.messages.innerHTML = (t.messages || []).map(renderBubble).join('');
    if (scrollToBottom || atBottom) el.messages.scrollTop = el.messages.scrollHeight;
  }

  function renderBubble(m) {
    var side = m.dir === 'out' ? 'out' : (m.dir === 'system' ? 'system' : 'in');
    var inner = '';
    switch (m.kind) {
      case 'text':
        inner = linkify(escapeHtml(m.body));
        break;
      case 'image':
        inner = (m.mediaUrl ? '<img src="' + m.mediaUrl + '">' : '<div class="tag">Photo received</div>') +
                (m.caption ? escapeHtml(m.caption) : '');
        break;
      case 'video':
        inner = '<div class="tag">Video</div>' + escapeHtml(m.caption || '');
        break;
      case 'audio':
        inner = '<div class="tag">Voice message</div>';
        break;
      case 'document':
        inner = '<div class="tag">Document</div>' + escapeHtml(m.filename || m.caption || '');
        break;
      case 'sticker':
        inner = '<div class="tag">Sticker</div>';
        break;
      case 'location':
        var loc = m.location || {};
        inner = '<div class="tag">Location</div>' + escapeHtml(loc.name || loc.address || (loc.latitude + ', ' + loc.longitude));
        break;
      case 'buttons':
        inner = escapeHtml(m.body) + '<div class="chips-inline">' +
          (m.buttons || []).map(function (b) { return '<span class="chip-inline">' + escapeHtml(b.title) + '</span>'; }).join('') + '</div>';
        break;
      case 'list':
        var rows = [];
        (m.sections || []).forEach(function (s) { (s.rows || []).forEach(function (r) { rows.push(r.title); }); });
        inner = escapeHtml(m.body) + '<div class="chips-inline">' +
          rows.map(function (r) { return '<span class="chip-inline">' + escapeHtml(r) + '</span>'; }).join('') + '</div>';
        break;
      case 'cta_url':
        inner = escapeHtml(m.body) + '<div class="ctaLink">&#128279; ' + escapeHtml((m.cta && m.cta.text) || 'Link') + '</div>';
        break;
      case 'button_reply':
      case 'list_reply':
      case 'template_button_reply':
        inner = '<div class="tag">Tapped</div>' + escapeHtml(m.body);
        break;
      case 'template':
        inner = '<div class="tag">Template: ' + escapeHtml(m.templateName || '') + '</div>' + escapeHtml(m.body || '');
        break;
      case 'order_created':
      case 'order_paid':
      case 'order_shipped':
        return '<div class="bubbleRow system"><div class="bubble system">' + escapeHtml(m.body) + '</div></div>';
      default:
        inner = escapeHtml(m.body || m.kind || '');
    }
    return '<div class="bubbleRow ' + side + '"><div class="bubble ' + side + '">' + inner +
      '<div class="msgTime">' + timeOfDay(m.at) + '</div></div></div>';
  }

  el.botToggle.addEventListener('change', function () {
    var on = el.botToggle.checked;
    el.botLabel.textContent = on ? 'Bot ON' : 'Bot OFF';
    api('/api/dashboard/bot', { method: 'POST', body: { phone: state.selectedPhone, on: on } }).then(function (r) {
      if (!r.ok) { el.botToggle.checked = !on; el.botLabel.textContent = !on ? 'Bot ON' : 'Bot OFF'; }
      else loadThread(false);
    });
  });

  // ---- reply box ----
  function autoGrow() {
    el.replyInput.style.height = 'auto';
    el.replyInput.style.height = Math.min(el.replyInput.scrollHeight, 100) + 'px';
  }
  el.replyInput.addEventListener('input', autoGrow);
  el.replyInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
  });
  el.sendBtn.addEventListener('click', sendReply);

  function sendReply() {
    var body = el.replyInput.value.trim();
    if (!body || !state.selectedPhone) return;
    el.sendBtn.disabled = true;
    el.replyError.classList.add('hidden');
    api('/api/dashboard/send', { method: 'POST', body: { phone: state.selectedPhone, body: body } }).then(function (r) {
      el.sendBtn.disabled = false;
      if (r.ok) {
        el.replyInput.value = '';
        autoGrow();
        loadThread(true);
      } else {
        el.replyError.textContent = r.json.error || 'Failed to send';
        el.replyError.classList.remove('hidden');
      }
    });
  }

  // ---- polling / visibility ----
  function startPolling() {
    clearInterval(state.listTimer);
    state.listTimer = setInterval(function () {
      if (document.hidden) return;
      loadConversations();
    }, 8000);
  }

  function showLogin() {
    clearInterval(state.listTimer);
    clearInterval(state.threadTimer);
    el.loginScreen.classList.remove('hidden');
  }

  function boot() {
    loadConversations();
    startPolling();
  }

  // Initial auth check.
  api('/api/dashboard/conversations').then(function (r) {
    if (r.status === 401) {
      el.loginScreen.classList.remove('hidden');
    } else {
      el.loginScreen.classList.add('hidden');
      state.conversations = (r.json && r.json.conversations) || [];
      renderList();
      startPolling();
    }
  });
})();
</script>
</body>
</html>`;
