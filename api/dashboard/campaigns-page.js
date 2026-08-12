// Bulk campaign builder — a separate self-contained page (same pattern as
// api/dashboard/index.js: no build step, inline CSS/JS) so neither page
// balloons into one unmanageable file. Shares the same auth cookie and
// visual language as the conversations dashboard.
export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(PAGE);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>GemHub Campaigns</title>
<style>
:root{
  --wa-header:#008069; --wa-bg:#f0f2f5; --wa-panel:#ffffff;
  --wa-text:#111b21; --wa-sub:#667781; --wa-border:#e9edef; --wa-green:#25d366;
  --wa-danger:#e35b5b; --wa-chip:#f0f2f5; --wa-accent:#008069; --wa-warn:#c9930b;
}
@media (prefers-color-scheme: dark){
  :root{
    --wa-header:#202c33; --wa-bg:#111b21; --wa-panel:#202c33;
    --wa-text:#e9edef; --wa-sub:#8696a0; --wa-border:#2a3942; --wa-green:#25d366;
    --wa-danger:#f2867e; --wa-chip:#2a3942; --wa-accent:#00a884; --wa-warn:#e0ac3f;
  }
}
*{box-sizing:border-box;}
html,body{margin:0;background:var(--wa-bg);color:var(--wa-text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;}
.hidden{display:none !important;}
#loginScreen{position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:var(--wa-bg); z-index:50;}
#loginBox{background:var(--wa-panel); padding:32px 28px; border-radius:12px; width:300px; box-shadow:0 2px 12px rgba(0,0,0,.15); text-align:center;}
#loginBox h1{font-size:20px; margin:0 0 4px; color:var(--wa-accent);}
#loginBox input{width:100%; padding:11px 12px; border:1px solid var(--wa-border); border-radius:8px; font-size:14px; background:var(--wa-bg); color:var(--wa-text); margin:10px 0;}
#loginBox button{width:100%; padding:11px; border:none; border-radius:8px; background:var(--wa-accent); color:#fff; font-size:14px; font-weight:600; cursor:pointer;}
#loginError{color:var(--wa-danger); font-size:12px; min-height:16px; margin-top:8px;}

header{background:var(--wa-header); color:#fff; padding:12px 20px; display:flex; align-items:center; gap:16px; flex-wrap:wrap;}
header h1{font-size:17px; margin:0; font-weight:600; flex-shrink:0;}
header a{color:#fff; opacity:.85; text-decoration:none; font-size:13px;}
#killBtn{margin-left:auto; background:var(--wa-danger); color:#fff; border:none; padding:8px 14px; border-radius:6px; font-weight:700; cursor:pointer; font-size:12.5px;}
#killBtn.active{background:#7a1f1f; box-shadow:0 0 0 2px #fff inset;}
#logoutLink{cursor:pointer;}

nav{display:flex; gap:4px; padding:10px 20px 0; background:var(--wa-panel); border-bottom:1px solid var(--wa-border);}
.tabBtn{padding:10px 16px; border:none; background:none; color:var(--wa-sub); font-size:14px; cursor:pointer; border-bottom:3px solid transparent; font-weight:500;}
.tabBtn.active{color:var(--wa-accent); border-bottom-color:var(--wa-accent);}
main{max-width:1100px; margin:0 auto; padding:20px;}
.tabPanel{display:none;}
.tabPanel.active{display:block;}

.card{background:var(--wa-panel); border-radius:10px; padding:18px 20px; margin-bottom:16px; box-shadow:0 1px 2px rgba(0,0,0,.05);}
.card h2{font-size:15px; margin:0 0 14px;}
label{display:block; font-size:12.5px; color:var(--wa-sub); margin-bottom:4px; margin-top:12px;}
label:first-child{margin-top:0;}
input[type=text],input[type=number],input[type=file],input[type=datetime-local],select,textarea{
  width:100%; padding:9px 11px; border:1px solid var(--wa-border); border-radius:6px; background:var(--wa-bg); color:var(--wa-text); font-size:13.5px; font-family:inherit;
}
.row{display:flex; gap:12px; flex-wrap:wrap;}
.row > div{flex:1; min-width:160px;}
button.primary{background:var(--wa-accent); color:#fff; border:none; padding:10px 18px; border-radius:6px; font-weight:600; cursor:pointer; font-size:13.5px;}
button.secondary{background:var(--wa-chip); color:var(--wa-text); border:none; padding:9px 16px; border-radius:6px; cursor:pointer; font-size:13px;}
button.danger{background:var(--wa-danger); color:#fff; border:none; padding:8px 14px; border-radius:6px; cursor:pointer; font-size:12.5px;}
button:disabled{opacity:.5; cursor:default;}
.hint{font-size:11.5px; color:var(--wa-sub); margin-top:4px;}
.err{color:var(--wa-danger); font-size:12.5px; margin-top:8px;}
.ok{color:var(--wa-green); font-size:12.5px; margin-top:8px;}

.varRow{display:flex; gap:8px; align-items:center; margin-bottom:8px; padding:8px; background:var(--wa-bg); border-radius:6px;}
.varRow .tag{font-size:11px; font-weight:700; color:var(--wa-accent); min-width:34px;}
#preview{background:var(--wa-bg); border-radius:8px; padding:14px; font-size:13.5px; white-space:pre-wrap; margin-top:10px; border:1px solid var(--wa-border);}

table{width:100%; border-collapse:collapse; font-size:13px;}
th{text-align:left; padding:8px 10px; color:var(--wa-sub); font-weight:600; font-size:11.5px; text-transform:uppercase; border-bottom:1px solid var(--wa-border);}
td{padding:9px 10px; border-bottom:1px solid var(--wa-border); vertical-align:top;}
.badge{padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; display:inline-block;}
.badge.running{background:#d9fdd3; color:#0b5a2a;}
.badge.draft{background:var(--wa-chip); color:var(--wa-sub);}
.badge.completed{background:#cfe8ff; color:#0b4a8a;}
.badge.paused_manual,.badge.paused_quality{background:#fde9c8; color:#7a4e00;}
.badge.stopped_quality,.badge.killed,.badge.failed{background:#fcdada; color:#7a1f1f;}
.badge.awaiting_approval,.badge.test_pending{background:#e6dcfa; color:#4b1f8a;}
.badge.scheduled{background:#e0f0ff; color:#0b4a8a;}
.progressBar{background:var(--wa-chip); border-radius:6px; height:8px; overflow:hidden; margin-top:4px; width:140px;}
.progressBar > div{background:var(--wa-accent); height:100%;}
.counters{display:flex; gap:10px; flex-wrap:wrap; font-size:11.5px; color:var(--wa-sub); margin-top:4px;}
.counters b{color:var(--wa-text);}
.campaignActions{display:flex; gap:6px; flex-wrap:wrap;}
.failureBox{background:var(--wa-bg); border-radius:6px; padding:10px; margin-top:8px; font-size:12.5px;}
</style>
</head>
<body>

<div id="loginScreen">
  <div id="loginBox">
    <h1>GemHub Campaigns</h1>
    <input id="pwInput" type="text" placeholder="Password" autocomplete="current-password" style="-webkit-text-security:disc;">
    <button id="loginBtn">Log in</button>
    <div id="loginError"></div>
  </div>
</div>

<div id="app" class="hidden">
  <header>
    <h1>GemHub Campaigns</h1>
    <a href="/dashboard">&#8592; Conversations</a>
    <button id="killBtn">&#128721; KILL SWITCH: OFF</button>
    <a id="logoutLink">Log out</a>
  </header>
  <nav>
    <button class="tabBtn active" data-tab="new">New Campaign</button>
    <button class="tabBtn" data-tab="monitor">Campaigns</button>
    <button class="tabBtn" data-tab="leads">Leads</button>
    <button class="tabBtn" data-tab="suppression">Suppression</button>
  </nav>
  <main>

    <div class="tabPanel active" id="tab-new">
      <div class="card">
        <h2>1. Template</h2>
        <label>Campaign name</label>
        <input type="text" id="campName" placeholder="e.g. Diwali collection blast">
        <label>Approved template</label>
        <select id="templateSelect"><option value="">Loading templates...</option></select>
        <div class="hint" id="templateMeta"></div>
        <div id="imageUploadWrap" class="hidden">
          <label id="imageUploadLabel">Header media (uploaded once, reused for every recipient)</label>
          <input type="file" id="imageFile" accept="image/*">
          <div class="hint" id="imageStatus"></div>
        </div>
      </div>

      <div class="card" id="mappingCard" style="display:none;">
        <h2>2. Variable mapping</h2>
        <div id="varRows"></div>
        <div id="preview"></div>
      </div>

      <div class="card" id="audienceCard" style="display:none;">
        <h2>3. Audience</h2>
        <div class="row">
          <div><label>Source</label><select id="filterSource"><option value="">Any</option></select></div>
          <div><label>Tag</label><select id="filterTag"><option value="">Any</option></select></div>
          <div><label>Lead list</label><select id="filterList"><option value="">Any</option></select></div>
          <div><label>Active within (days)</label><input type="number" id="filterDays" placeholder="e.g. 30"></div>
        </div>
        <button class="secondary" id="previewAudienceBtn" style="margin-top:12px;">Preview audience</button>
        <div class="hint" id="audienceResult"></div>
      </div>

      <div class="card" id="scheduleCard" style="display:none;">
        <h2>4. Throttle, cooldown &amp; schedule</h2>
        <div class="row">
          <div><label>Messages / second</label><input type="number" id="throttle" value="1" min="0.2" step="0.2"></div>
          <div><label>Cooldown between campaigns (days)</label><input type="number" id="cooldown" value="7" min="1"></div>
        </div>
        <label>Send</label>
        <select id="scheduleMode"><option value="now">Now</option><option value="later">At a scheduled time</option></select>
        <input type="datetime-local" id="scheduleAt" class="hidden" style="margin-top:8px;">
      </div>

      <div class="card" id="launchCard" style="display:none;">
        <h2>5. Review &amp; launch</h2>
        <div id="launchSummary" class="hint"></div>
        <div style="margin-top:12px;">
          <button class="primary" id="createBtn">Create campaign</button>
        </div>
        <div id="postCreateActions" class="hidden" style="margin-top:14px;">
          <div id="testGate" class="hidden">
            <p class="hint">This campaign exceeds the test-send threshold — a test message to the owner's number and explicit approval are required before it can launch.</p>
            <button class="secondary" id="testSendBtn">Send test message to owner</button>
            <button class="primary hidden" id="approveBtn">Approve &amp; launch</button>
          </div>
          <div id="directLaunch" class="hidden">
            <button class="primary" id="launchBtn">Launch now</button>
          </div>
        </div>
        <div id="createErr" class="err"></div>
        <div id="createOk" class="ok"></div>
      </div>
    </div>

    <div class="tabPanel" id="tab-monitor">
      <div class="card">
        <h2>Campaigns</h2>
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>Progress</th><th>Counters</th><th>Actions</th></tr></thead>
          <tbody id="campaignsBody"></tbody>
        </table>
      </div>
    </div>

    <div class="tabPanel" id="tab-leads">
      <div class="card">
        <h2>Import from CSV</h2>
        <label>List name</label>
        <input type="text" id="csvListName" placeholder="e.g. August cold list">
        <label>CSV file (columns: phone, name, source, tags, lastActivityAt, plus any extra columns)</label>
        <input type="file" id="csvFile" accept=".csv,text/csv">
        <div id="csvPreview" class="hint"></div>
        <button class="primary" id="csvImportBtn" style="margin-top:10px;" disabled>Import all rows</button>
        <div id="csvProgress" class="hint"></div>
      </div>
      <div class="card">
        <h2>Zoho CRM sync</h2>
        <div id="zohoStatus" class="hint">Checking...</div>
        <button class="secondary" id="zohoSyncBtn" style="margin-top:10px;">Sync from Zoho</button>
      </div>
      <div class="card">
        <h2>Lead lists <span id="totalLeadsLabel" class="hint"></span></h2>
        <table>
          <thead><tr><th>List</th><th>Source</th><th>Count</th><th>Imported</th></tr></thead>
          <tbody id="leadListsBody"></tbody>
        </table>
      </div>
    </div>

    <div class="tabPanel" id="tab-suppression">
      <div class="card">
        <h2>Suppression list <span id="suppressionCount" class="hint"></span></h2>
        <div class="row">
          <div><input type="text" id="addSuppressPhone" placeholder="Phone number to add"></div>
          <div style="flex:0;"><button class="secondary" id="addSuppressBtn">Add</button></div>
        </div>
        <table style="margin-top:14px;">
          <thead><tr><th>Phone</th><th>Opted out</th><th>Via</th><th></th></tr></thead>
          <tbody id="suppressionBody"></tbody>
        </table>
      </div>
    </div>

  </main>
</div>

<script>
(function () {
  'use strict';
  var state = { templates: [], selectedTemplate: null, mediaId: null, campaignId: null, requiresTestSend: false, leadsMeta: null };
  var el = {};
  ['pwInput','loginBtn','loginError','loginScreen','app','killBtn','logoutLink',
   'campName','templateSelect','templateMeta','imageUploadWrap','imageUploadLabel','imageFile','imageStatus',
   'mappingCard','varRows','preview','audienceCard','filterSource','filterTag','filterList','filterDays',
   'previewAudienceBtn','audienceResult','scheduleCard','throttle','cooldown','scheduleMode','scheduleAt',
   'launchCard','launchSummary','createBtn','postCreateActions','testGate','testSendBtn','approveBtn',
   'directLaunch','launchBtn','createErr','createOk','campaignsBody',
   'csvListName','csvFile','csvPreview','csvImportBtn','csvProgress','zohoStatus','zohoSyncBtn',
   'totalLeadsLabel','leadListsBody','suppressionCount','addSuppressPhone','addSuppressBtn','suppressionBody'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) { return { ok: res.ok, status: res.status, json: json }; });
    });
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; });
  }
  function relTime(ms) {
    if (!ms) return '';
    var min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return 'now';
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    return Math.floor(hr / 24) + 'd ago';
  }

  // ---- auth ----
  function tryLogin() {
    var pw = el.pwInput.value;
    if (!pw) return;
    api('/api/dashboard/login', { method: 'POST', body: { password: pw } }).then(function (r) {
      if (r.ok) { el.loginScreen.classList.add('hidden'); el.app.classList.remove('hidden'); boot(); }
      else el.loginError.textContent = r.json.error || 'Login failed';
    });
  }
  el.loginBtn.addEventListener('click', tryLogin);
  el.pwInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });
  el.logoutLink.addEventListener('click', function () { api('/api/dashboard/logout', { method: 'POST' }).then(function () { window.location.reload(); }); });

  // ---- tabs ----
  document.querySelectorAll('.tabBtn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tabBtn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tabPanel').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.getAttribute('data-tab')).classList.add('active');
      if (btn.getAttribute('data-tab') === 'monitor') loadCampaigns();
      if (btn.getAttribute('data-tab') === 'leads') { loadLeadsMeta(); loadZohoStatus(); }
      if (btn.getAttribute('data-tab') === 'suppression') loadSuppression();
    });
  });

  // ---- kill switch ----
  function renderKill(on) {
    el.killBtn.textContent = on ? '\\u{1F6D1} KILL SWITCH: ON' : '\\u{1F6D1} KILL SWITCH: OFF';
    el.killBtn.classList.toggle('active', on);
  }
  el.killBtn.addEventListener('click', function () {
    var turningOn = !el.killBtn.classList.contains('active');
    if (turningOn && !confirm('Stop ALL running campaigns immediately?')) return;
    api('/api/dashboard/campaigns/killswitch', { method: 'POST', body: { on: turningOn } }).then(function (r) {
      if (r.ok) renderKill(r.json.on);
    });
  });

  // ---- New Campaign: templates ----
  function loadTemplates() {
    api('/api/dashboard/campaigns/templates').then(function (r) {
      if (!r.ok) return;
      state.templates = (r.json.templates || []).filter(function (t) { return t.status === 'APPROVED'; });
      el.templateSelect.innerHTML = '<option value="">Select a template...</option>' + state.templates.map(function (t) {
        return '<option value="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + ' (' + t.category + ', ' + t.language + ')</option>';
      }).join('');
    });
  }
  el.templateSelect.addEventListener('change', function () {
    var t = state.templates.find(function (x) { return x.name === el.templateSelect.value; });
    state.selectedTemplate = t || null;
    state.mediaId = null;
    if (!t) { el.mappingCard.style.display = 'none'; el.audienceCard.style.display = 'none'; el.scheduleCard.style.display = 'none'; el.launchCard.style.display = 'none'; return; }
    el.templateMeta.textContent = 'Header: ' + (t.headerFormat || 'none') + ' \\u00b7 Body variables: ' + t.bodyVarCount + (t.buttons.length ? ' \\u00b7 Buttons: ' + t.buttons.map(function(b){return b.type;}).join(',') : '');
    var needsMedia = t.headerFormat === 'IMAGE' || t.headerFormat === 'VIDEO';
    el.imageUploadWrap.classList.toggle('hidden', !needsMedia);
    if (needsMedia) {
      el.imageFile.setAttribute('accept', t.headerFormat === 'VIDEO' ? 'video/*' : 'image/*');
      el.imageUploadLabel.textContent = (t.headerFormat === 'VIDEO' ? 'Header video' : 'Header image') + ' (uploaded once, reused for every recipient)';
    }
    renderVarRows(t);
    el.mappingCard.style.display = 'block';
    el.audienceCard.style.display = 'block';
    el.scheduleCard.style.display = 'block';
    el.launchCard.style.display = 'block';
  });

  el.imageFile.addEventListener('change', function () {
    var file = el.imageFile.files[0];
    if (!file) return;
    el.imageStatus.textContent = 'Uploading...';
    var reader = new FileReader();
    reader.onload = function () {
      var base64 = reader.result.split(',')[1];
      api('/api/dashboard/campaigns/media-upload', { method: 'POST', body: { filename: file.name, mimeType: file.type, dataBase64: base64 } }).then(function (r) {
        if (r.ok) { state.mediaId = r.json.mediaId; el.imageStatus.textContent = 'Uploaded \\u2713 (media id ' + r.json.mediaId + ')'; }
        else el.imageStatus.textContent = 'Upload failed: ' + r.json.error;
      });
    };
    reader.readAsDataURL(file);
  });

  function renderVarRows(t) {
    var rows = [];
    for (var i = 1; i <= t.bodyVarCount; i++) {
      rows.push(
        '<div class="varRow" data-idx="' + i + '">' +
          '<span class="tag">{{' + i + '}}</span>' +
          '<select class="varSource" style="max-width:150px;">' +
            '<option value="static">Static text</option>' +
            '<option value="name">Lead name</option>' +
            '<option value="phone">Lead phone</option>' +
            '<option value="column">CSV column</option>' +
          '</select>' +
          '<input type="text" class="varValue" placeholder="value or column name" style="flex:1;">' +
        '</div>'
      );
    }
    el.varRows.innerHTML = rows.join('');
    el.varRows.querySelectorAll('.varSource,.varValue').forEach(function (node) { node.addEventListener('input', updatePreview); node.addEventListener('change', updatePreview); });
    updatePreview();
  }

  function currentMapping() {
    var mapping = {};
    el.varRows.querySelectorAll('.varRow').forEach(function (row) {
      var idx = row.getAttribute('data-idx');
      var source = row.querySelector('.varSource').value;
      var value = row.querySelector('.varValue').value;
      mapping[idx] = source === 'static' ? { source: 'static', value: value } : source === 'column' ? { source: 'column', value: value } : { source: source };
    });
    return mapping;
  }

  function updatePreview() {
    if (!state.selectedTemplate) return;
    var mapping = currentMapping();
    var text = state.selectedTemplate.bodyText;
    var sample = { name: 'Priya', phone: '919876543210' };
    Object.keys(mapping).forEach(function (idx) {
      var m = mapping[idx];
      var val = m.source === 'static' ? (m.value || '\\u2026') : m.source === 'name' ? sample.name : m.source === 'phone' ? sample.phone : '[' + (m.value || 'column') + ']';
      text = text.split('{{' + idx + '}}').join(val);
    });
    el.preview.textContent = text;
  }

  // ---- audience ----
  function loadFilterOptions() {
    api('/api/dashboard/leads/meta').then(function (r) {
      if (!r.ok) return;
      state.leadsMeta = r.json;
      el.filterSource.innerHTML = '<option value="">Any</option>' + r.json.sources.map(function (s) { return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>'; }).join('');
      el.filterTag.innerHTML = '<option value="">Any</option>' + r.json.tags.map(function (t) { return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>'; }).join('');
      el.filterList.innerHTML = '<option value="">Any</option>' + r.json.lists.map(function (l) { return '<option value="' + escapeHtml(l.id) + '">' + escapeHtml(l.name) + ' (' + l.count + ')</option>'; }).join('');
    });
  }
  function currentFilter() {
    var f = {};
    if (el.filterSource.value) f.source = el.filterSource.value;
    if (el.filterTag.value) f.tag = el.filterTag.value;
    if (el.filterList.value) f.listId = el.filterList.value;
    if (el.filterDays.value) f.lastActivityWithinDays = Number(el.filterDays.value);
    return f;
  }
  el.previewAudienceBtn.addEventListener('click', function () {
    el.audienceResult.textContent = 'Resolving...';
    api('/api/dashboard/campaigns/audience-preview', { method: 'POST', body: { filter: currentFilter() } }).then(function (r) {
      if (!r.ok) { el.audienceResult.textContent = 'Error: ' + r.json.error; return; }
      el.audienceResult.textContent = r.json.count + ' matching leads. Sample: ' + r.json.sample.map(function (s) { return s.name || s.phone; }).join(', ');
    });
  });

  el.scheduleMode.addEventListener('change', function () { el.scheduleAt.classList.toggle('hidden', el.scheduleMode.value !== 'later'); });

  // ---- create / test-send / approve / launch ----
  el.createBtn.addEventListener('click', function () {
    if (!state.selectedTemplate) return;
    el.createErr.textContent = ''; el.createOk.textContent = '';
    var scheduledAt = el.scheduleMode.value === 'later' && el.scheduleAt.value ? new Date(el.scheduleAt.value).getTime() : null;
    api('/api/dashboard/campaigns/create', { method: 'POST', body: {
      name: el.campName.value,
      templateName: state.selectedTemplate.name,
      variableMapping: currentMapping(),
      imageMediaId: state.mediaId,
      audienceFilter: currentFilter(),
      throttlePerSec: Number(el.throttle.value) || 1,
      cooldownDays: Number(el.cooldown.value) || 7,
      scheduledAt: scheduledAt,
    }}).then(function (r) {
      if (!r.ok) { el.createErr.textContent = r.json.error; return; }
      state.campaignId = r.json.campaignId;
      state.requiresTestSend = r.json.requiresTestSend;
      el.createOk.textContent = 'Campaign created \\u2713 ' + r.json.totalRecipients + ' recipients.';
      el.postCreateActions.classList.remove('hidden');
      el.testGate.classList.toggle('hidden', !r.json.requiresTestSend);
      el.directLaunch.classList.toggle('hidden', r.json.requiresTestSend);
      el.createBtn.disabled = true;
    });
  });
  el.testSendBtn.addEventListener('click', function () {
    api('/api/dashboard/campaigns/test-send', { method: 'POST', body: { campaignId: state.campaignId } }).then(function (r) {
      if (!r.ok) { el.createErr.textContent = r.json.error; return; }
      el.createOk.textContent = 'Test message sent to the owner\\u2019s number. Review it, then approve.';
      el.approveBtn.classList.remove('hidden');
      el.testSendBtn.disabled = true;
    });
  });
  el.approveBtn.addEventListener('click', function () {
    api('/api/dashboard/campaigns/approve', { method: 'POST', body: { campaignId: state.campaignId } }).then(function (r) {
      if (!r.ok) { el.createErr.textContent = r.json.error; return; }
      el.createOk.textContent = 'Approved \\u2014 campaign is now running.';
      el.approveBtn.disabled = true;
    });
  });
  el.launchBtn.addEventListener('click', function () {
    api('/api/dashboard/campaigns/launch', { method: 'POST', body: { campaignId: state.campaignId } }).then(function (r) {
      if (!r.ok) { el.createErr.textContent = r.json.error; return; }
      el.createOk.textContent = r.json.status === 'scheduled' ? 'Scheduled.' : 'Launched \\u2014 campaign is now running.';
      el.launchBtn.disabled = true;
    });
  });

  // ---- Campaigns monitor ----
  var STATUS_LABEL = { draft:'Draft', test_pending:'Test pending', awaiting_approval:'Awaiting approval', scheduled:'Scheduled', running:'Running', paused_manual:'Paused', paused_quality:'Paused (quality)', stopped_quality:'Stopped (quality)', killed:'Killed', completed:'Completed', failed:'Failed' };
  function loadCampaigns() {
    api('/api/dashboard/campaigns/list').then(function (r) {
      if (!r.ok) return;
      el.campaignsBody.innerHTML = r.json.campaigns.map(renderCampaignRow).join('') || '<tr><td colspan="5" class="hint">No campaigns yet.</td></tr>';
      bindCampaignActions();
    });
  }
  function renderCampaignRow(c) {
    var pct = c.totalRecipients ? Math.round((c.cursor / c.totalRecipients) * 100) : 0;
    var actions = '';
    if (c.status === 'running') actions += '<button class="secondary" data-action="pause" data-id="' + c.id + '">Pause</button>';
    if (c.status === 'paused_manual' || c.status === 'paused_quality') actions += '<button class="secondary" data-action="resume" data-id="' + c.id + '">Resume</button>';
    if (c.counters.failed > 0) actions += '<button class="secondary" data-action="failures" data-id="' + c.id + '">Failures (' + c.counters.failed + ')</button>';
    return '<tr><td>' + escapeHtml(c.name) + '<div class="hint">' + escapeHtml(c.templateName) + '</div></td>' +
      '<td><span class="badge ' + c.status + '">' + (STATUS_LABEL[c.status] || c.status) + '</span></td>' +
      '<td>' + c.cursor + ' / ' + c.totalRecipients + '<div class="progressBar"><div style="width:' + pct + '%"></div></div></td>' +
      '<td><div class="counters">Sent <b>' + c.counters.sent + '</b> Delivered <b>' + c.counters.delivered + '</b> Read <b>' + c.counters.read + '</b> Failed <b>' + c.counters.failed + '</b> Replied <b>' + c.counters.replied + '</b> Opted-out <b>' + c.counters.optedOut + '</b></div></td>' +
      '<td><div class="campaignActions">' + actions + '</div><div class="failureBox hidden" id="fb-' + c.id + '"></div></td></tr>';
  }
  function bindCampaignActions() {
    el.campaignsBody.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        if (action === 'pause') api('/api/dashboard/campaigns/pause', { method: 'POST', body: { campaignId: id } }).then(loadCampaigns);
        else if (action === 'resume') api('/api/dashboard/campaigns/resume', { method: 'POST', body: { campaignId: id } }).then(loadCampaigns);
        else if (action === 'failures') {
          var box = document.getElementById('fb-' + id);
          box.classList.toggle('hidden');
          if (!box.classList.contains('hidden')) {
            box.textContent = 'Loading...';
            api('/api/dashboard/campaigns/failures?id=' + encodeURIComponent(id)).then(function (r) {
              if (!r.ok) { box.textContent = 'Error loading failures'; return; }
              box.innerHTML = r.json.breakdown.map(function (b) { return escapeHtml(b.reason) + ': <b>' + b.count + '</b>'; }).join('<br>') || 'No failures.';
            });
          }
        }
      });
    });
  }

  // ---- Leads tab: CSV ----
  var parsedRows = [];
  function parseCSV(text) {
    var lines = text.split(/\\r?\\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var headers = splitCsvLine(lines[0]).map(function (h) { return h.trim(); });
    return lines.slice(1).map(function (line) {
      var cells = splitCsvLine(line);
      var row = {};
      headers.forEach(function (h, i) { row[h] = cells[i] !== undefined ? cells[i].trim() : ''; });
      return row;
    });
  }
  function splitCsvLine(line) {
    var out = []; var cur = ''; var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; }
      else { cur += ch; }
    }
    out.push(cur);
    return out;
  }
  el.csvFile.addEventListener('change', function () {
    var file = el.csvFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      parsedRows = parseCSV(String(reader.result));
      var cols = parsedRows.length ? Object.keys(parsedRows[0]) : [];
      el.csvPreview.textContent = parsedRows.length + ' rows detected. Columns: ' + cols.join(', ');
      el.csvImportBtn.disabled = parsedRows.length === 0;
    };
    reader.readAsText(file);
  });
  el.csvImportBtn.addEventListener('click', function () {
    if (!parsedRows.length) return;
    var listId = 'csv_' + Date.now();
    var listName = el.csvListName.value || ('CSV import ' + new Date().toLocaleDateString());
    var rows = parsedRows.map(function (r) {
      var extra = {};
      Object.keys(r).forEach(function (k) { if (!['phone','name','source','tags','lastActivityAt'].includes(k)) extra[k] = r[k]; });
      return {
        phone: r.phone, name: r.name, source: r.source,
        tags: r.tags ? r.tags.split(/[|;]/).map(function (t) { return t.trim(); }).filter(Boolean) : [],
        lastActivityAt: r.lastActivityAt ? new Date(r.lastActivityAt).getTime() : undefined,
        extra: extra,
      };
    });
    el.csvImportBtn.disabled = true;
    var BATCH = 500; var i = 0; var totalImported = 0; var totalInvalid = 0;
    function nextBatch() {
      var batch = rows.slice(i, i + BATCH);
      if (!batch.length) {
        el.csvProgress.textContent = 'Done: ' + totalImported + ' imported, ' + totalInvalid + ' invalid.';
        el.csvImportBtn.disabled = false;
        loadLeadsMeta();
        loadFilterOptions();
        return;
      }
      el.csvProgress.textContent = 'Uploading ' + i + ' / ' + rows.length + '...';
      api('/api/dashboard/leads/upload', { method: 'POST', body: { listId: listId, listName: listName, isFirstBatch: i === 0, rows: batch } }).then(function (r) {
        if (r.ok) { totalImported += r.json.imported; totalInvalid += r.json.invalid; }
        i += BATCH;
        nextBatch();
      });
    }
    nextBatch();
  });

  function loadLeadsMeta() {
    api('/api/dashboard/leads/meta').then(function (r) {
      if (!r.ok) return;
      el.totalLeadsLabel.textContent = '(' + r.json.totalLeads + ' total)';
      el.leadListsBody.innerHTML = r.json.lists.map(function (l) {
        return '<tr><td>' + escapeHtml(l.name) + '</td><td>' + escapeHtml(l.sourceType) + '</td><td>' + l.count + '</td><td>' + relTime(l.createdAt) + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="hint">No lists yet.</td></tr>';
    });
  }
  function loadZohoStatus() {
    api('/api/dashboard/leads/zoho-status').then(function (r) {
      if (!r.ok) return;
      if (!r.json.configured) { el.zohoStatus.textContent = 'Not configured yet \\u2014 set ZOHO_CLIENT_ID / SECRET / REFRESH_TOKEN.'; el.zohoSyncBtn.disabled = true; return; }
      el.zohoStatus.textContent = 'Status: ' + r.json.status + (r.json.imported ? ' \\u2014 ' + r.json.imported + ' imported' : '') + (r.json.lastError ? ' \\u2014 error: ' + r.json.lastError : '');
    });
  }
  el.zohoSyncBtn.addEventListener('click', function () {
    el.zohoSyncBtn.disabled = true;
    api('/api/dashboard/leads/zoho-start', { method: 'POST' }).then(function () {
      var poll = setInterval(function () {
        api('/api/dashboard/leads/zoho-status').then(function (r) {
          if (!r.ok) return;
          el.zohoStatus.textContent = 'Status: ' + r.json.status + ' \\u2014 ' + r.json.imported + ' imported';
          if (r.json.status === 'done' || r.json.status === 'error') { clearInterval(poll); el.zohoSyncBtn.disabled = false; loadLeadsMeta(); }
        });
      }, 4000);
    });
  });

  // ---- Suppression ----
  function loadSuppression() {
    api('/api/dashboard/suppression/list').then(function (r) {
      if (!r.ok) return;
      el.suppressionCount.textContent = '(' + r.json.count + ')';
      el.suppressionBody.innerHTML = r.json.entries.map(function (e) {
        return '<tr><td>' + escapeHtml(e.phone) + '</td><td>' + relTime(e.at) + '</td><td>' + escapeHtml(e.via) + '</td>' +
          '<td><button class="danger" data-phone="' + escapeHtml(e.phone) + '">Remove</button></td></tr>';
      }).join('') || '<tr><td colspan="4" class="hint">No suppressed numbers.</td></tr>';
      el.suppressionBody.querySelectorAll('button[data-phone]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          api('/api/dashboard/suppression/remove', { method: 'POST', body: { phone: btn.getAttribute('data-phone') } }).then(loadSuppression);
        });
      });
    });
  }
  el.addSuppressBtn.addEventListener('click', function () {
    if (!el.addSuppressPhone.value) return;
    api('/api/dashboard/suppression/add', { method: 'POST', body: { phone: el.addSuppressPhone.value } }).then(function (r) {
      if (r.ok) { el.addSuppressPhone.value = ''; loadSuppression(); }
    });
  });

  // ---- boot ----
  var pollTimer = null;
  function boot() {
    loadTemplates();
    loadFilterOptions();
    api('/api/dashboard/campaigns/killswitch').then(function (r) { if (r.ok) renderKill(r.json.on); });
    loadCampaigns();
    clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.hidden) return;
      if (document.getElementById('tab-monitor').classList.contains('active')) loadCampaigns();
    }, 6000);
  }

  api('/api/dashboard/campaigns/list').then(function (r) {
    if (r.status === 401) { el.loginScreen.classList.remove('hidden'); }
    else { el.loginScreen.classList.add('hidden'); el.app.classList.remove('hidden'); boot(); }
  });
})();
</script>
</body>
</html>`;
