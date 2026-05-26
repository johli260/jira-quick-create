'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let tickets = [];   // { id, file }
let ticketCounter = 0;
let settings = {};
let cachedLinkType = null;  // resolved once per session

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  settings = await loadSettings();

  // main view bindings
  document.getElementById('btn-add-ticket').addEventListener('click', addTicket);
  document.getElementById('btn-submit-all').addEventListener('click', submitAll);
  document.getElementById('btn-settings').addEventListener('click', () => showView('settings'));

  document.getElementById('m-project').addEventListener('change', persistMainConfig);
  document.getElementById('m-issuetype').addEventListener('change', () => {
    persistMainConfig();
    const sel = document.getElementById('m-issuetype');
    const opt = sel.options[sel.selectedIndex];
    const projectKey = document.getElementById('m-project-key').value;
    if (projectKey && opt && opt.dataset.id) {
      loadRequiredFields(projectKey, opt.dataset.id, opt.textContent.trim());
    } else {
      clearRequiredFields();
    }
  });

  // parent ticket toggle
  document.getElementById('toggle-parent').addEventListener('change', () => {
    document.getElementById('parent-checkbox-row').classList.add('hidden');
    document.getElementById('global-parent-field').classList.remove('hidden');
    document.getElementById('global-parent-input').focus();
    syncTeamMargin();
  });
  document.getElementById('btn-remove-parent').addEventListener('click', () => {
    document.getElementById('global-parent-field').classList.add('hidden');
    document.getElementById('parent-checkbox-row').classList.remove('hidden');
    document.getElementById('toggle-parent').checked = false;
    document.getElementById('global-parent-input').value = '';
    syncTeamMargin();
  });

  // label toggle
  document.getElementById('toggle-team').addEventListener('change', () => {
    document.getElementById('team-checkbox-row').classList.add('hidden');
    document.getElementById('global-team-field').classList.remove('hidden');
    syncFieldMargins();
    document.getElementById('global-team-input').focus();
  });
  document.getElementById('btn-remove-team').addEventListener('click', () => {
    document.getElementById('global-team-field').classList.add('hidden');
    document.getElementById('team-checkbox-row').classList.remove('hidden');
    document.getElementById('toggle-team').checked = false;
    document.getElementById('global-team-input').value = '';
    syncFieldMargins();
  });

  function syncFieldMargins() {
    const parentOpen = !document.getElementById('global-parent-field').classList.contains('hidden');
    document.getElementById('global-team-field').style.marginTop = parentOpen ? '0' : '10px';
  }



  // settings view bindings
  document.getElementById('btn-back').addEventListener('click', () => {
    showView('main');
    if (!allProjects.length && settings.url && settings.email && settings.token) {
      loadAllProjects();
      loadFieldDefinitions();
      if (!tickets.length) addTicket();
    }
  });
  document.getElementById('btn-save').addEventListener('click', saveSettings);
  document.getElementById('btn-test').addEventListener('click', testConnection);

  populateSettingsForm();

  const hasAccount = settings.url && settings.email && settings.token;
  if (hasAccount) {
    showView('main');
    loadAllProjects();
    loadFieldDefinitions();
    addTicket();
  } else {
    showView('settings');
  }
});

// ── Views ──────────────────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
}

// ── Settings persistence ───────────────────────────────────────────────────
function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get('jira_settings', data => {
      resolve(data.jira_settings || {});
    });
  });
}

function persistSettings(obj) {
  return new Promise(resolve => {
    chrome.storage.local.set({ jira_settings: obj }, resolve);
  });
}

function populateSettingsForm() {
  if (settings.url)   document.getElementById('s-url').value = settings.url;
  if (settings.email) document.getElementById('s-email').value = settings.email;
  if (settings.token) document.getElementById('s-token').value = settings.token;
}


async function persistMainConfig() {
  settings.project = document.getElementById('m-project-key').value;
  await persistSettings(settings);
}

async function saveSettings() {
  const obj = {
    ...settings,
    url:   document.getElementById('s-url').value.trim().replace(/\/$/, ''),
    email: document.getElementById('s-email').value.trim(),
    token: document.getElementById('s-token').value.trim(),
  };
  await persistSettings(obj);
  settings = obj;
  showSettingsStatus('Settings saved.', 'success');
  allProjects = [];
  fieldNameToKey = {};
  fieldDefsPromise = null;
  loadAllProjects();
  loadFieldDefinitions();
}

async function testConnection() {
  const url   = document.getElementById('s-url').value.trim().replace(/\/$/, '');
  const email = document.getElementById('s-email').value.trim();
  const token = document.getElementById('s-token').value.trim();

  if (!url || !email || !token) {
    showSettingsStatus('Fill in URL, email, and token first.', 'error');
    return;
  }

  showSettingsStatus('Testing…', 'info');
  try {
    const res = await jiraFetch(`${url}/rest/api/3/myself`, email, token);
    if (res.ok) {
      const data = await res.json();
      showSettingsStatus(`Connected as ${data.displayName || data.emailAddress}.`, 'success');
    } else {
      const err = await res.json().catch(() => ({}));
      showSettingsStatus(`Error ${res.status}: ${err.message || 'Check your credentials.'}`, 'error');
    }
  } catch (e) {
    showSettingsStatus(`Network error: ${e.message}`, 'error');
  }
}


function showSettingsStatus(msg, type) {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = `settings-status ${type}`;
}

// ── Ticket management ──────────────────────────────────────────────────────
function addTicket() {
  const id = ++ticketCounter;
  tickets.push({ id, file: null });

  const tmpl = document.getElementById('ticket-template');
  const node = tmpl.content.cloneNode(true);
  const card = node.querySelector('.ticket-card');
  card.dataset.id = id;
  const label = card.querySelector('.ticket-number');
  const fallback = `Ticket #${id}`;
  label.textContent = fallback;

  // collapse toggle
  card.querySelector('.ticket-collapse').addEventListener('click', () => {
    card.classList.toggle('collapsed');
    updateCollapseIcon(card);
  });

  // remove button
  card.querySelector('.ticket-remove').addEventListener('click', () => removeTicket(id, card));

  // drop zone
  const dropZone  = card.querySelector('.drop-zone');
  const fileInput = card.querySelector('.file-input');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && (f.type.startsWith('image/') || f.type.startsWith('video/'))) attachFile(id, card, f);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) attachFile(id, card, fileInput.files[0]);
  });

  // remove preview image
  card.querySelector('.preview-remove').addEventListener('click', e => {
    e.stopPropagation();
    clearFile(id, card);
  });

  // Sync header label with title input
  card.querySelector('.ticket-title').addEventListener('input', e => {
    label.textContent = e.target.value.trim() || fallback;
  });

  // Collapse all existing cards before appending the new one
  document.querySelectorAll('.ticket-card').forEach(c => {
    c.classList.add('collapsed');
    updateCollapseIcon(c);
  });

  document.getElementById('tickets-container').appendChild(card);
  updateSubmitButton();
  card.querySelector('.ticket-title').focus();
  requestAnimationFrame(() => {
    const scroll = document.getElementById('main-scroll');
    scroll.scrollTop = scroll.scrollHeight;
  });
}

function removeTicket(id, card) {
  tickets = tickets.filter(t => t.id !== id);
  card.remove();
  updateSubmitButton();
}

function updateCollapseIcon(card) {
  const btn = card.querySelector('.ticket-collapse');
  const collapsed = card.classList.contains('collapsed');
  btn.title = collapsed ? 'Expand' : 'Collapse';
  btn.querySelector('svg path').setAttribute('d',
    collapsed
      ? 'M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'
      : 'M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z'
  );
}


function attachFile(id, card, file) {
  const t = tickets.find(t => t.id === id);
  if (t) t.file = file;

  const isVideo = file.type.startsWith('video/');
  const img     = card.querySelector('.preview-img');
  const vid     = card.querySelector('.preview-video');

  const reader = new FileReader();
  reader.onload = e => {
    if (isVideo) {
      vid.src = e.target.result;
      vid.classList.remove('hidden');
      img.classList.add('hidden');
      img.src = '';
    } else {
      img.src = e.target.result;
      img.classList.remove('hidden');
      vid.classList.add('hidden');
      vid.src = '';
    }
    card.querySelector('.preview-name').textContent = file.name;
    card.querySelector('.drop-zone-prompt').classList.add('hidden');
    card.querySelector('.drop-zone-preview').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearFile(id, card) {
  const t = tickets.find(t => t.id === id);
  if (t) t.file = null;
  card.querySelector('.file-input').value = '';
  card.querySelector('.preview-img').src = '';
  card.querySelector('.preview-video').src = '';
  card.querySelector('.preview-video').classList.add('hidden');
  card.querySelector('.preview-img').classList.remove('hidden');
  card.querySelector('.drop-zone-prompt').classList.remove('hidden');
  card.querySelector('.drop-zone-preview').classList.add('hidden');
}

function updateSubmitButton() {
  document.getElementById('btn-submit-all').disabled = tickets.length === 0;
}

// ── Submit ─────────────────────────────────────────────────────────────────
async function submitAll() {
  if (!validateSettings()) return;

  const globalParent = document.getElementById('global-parent-input').value.trim().toUpperCase() || null;

  // collect + validate each ticket
  const cards = document.querySelectorAll('.ticket-card');
  const jobs = [];
  let hasError = false;

  cards.forEach(card => {
    const id    = parseInt(card.dataset.id);
    const title = card.querySelector('.ticket-title').value.trim();
    const desc  = card.querySelector('.ticket-description').value.trim();
    const state = tickets.find(t => t.id === id);

    if (!title) {
      card.querySelector('.ticket-title').classList.add('invalid');
      setTicketStatus(card, 'error', 'Title is required.');
      hasError = true;
    } else {
      card.querySelector('.ticket-title').classList.remove('invalid');
      jobs.push({ id, card, title, desc, parent: globalParent, file: state ? state.file : null });
    }
  });

  if (hasError) {
    showStatusBar('Fix the highlighted tickets before submitting.', 'error');
    return;
  }

  // lock UI
  setSubmitting(true);
  showStatusBar(`Submitting ${jobs.length} ticket${jobs.length > 1 ? 's' : ''}…`, 'info');

  let done = 0, failed = 0;

  for (const job of jobs) {
    setTicketStatus(job.card, 'loading', 'Creating issue…');
    try {
      const issueKey = await createIssue(job.title, job.desc);
      if (job.file) {
        setTicketStatus(job.card, 'loading', 'Uploading attachment…');
        await uploadAttachment(issueKey, job.file);
      }
      if (globalParent) {
        setTicketStatus(job.card, 'loading', 'Linking to parent…');
        await linkIssue(issueKey, globalParent);
      }
      const issueUrl = `${settings.url}/browse/${issueKey}`;
      const parentSuffix = globalParent ? ` → required by ${globalParent}` : '';
      setTicketStatus(job.card, 'success', `Created <a href="${issueUrl}" target="_blank" rel="noopener">${issueKey}</a>${parentSuffix} ✓`);
      job.card.classList.add('done');
      job.card.classList.remove('failed');
      done++;
    } catch (e) {
      setTicketStatus(job.card, 'error', e.message);
      job.card.classList.add('failed');
      job.card.classList.remove('done');
      failed++;
    }
  }

  setSubmitting(false);
  if (failed === 0) {
    showStatusBar(`All ${done} ticket${done > 1 ? 's' : ''} created successfully!`, 'success');
  } else {
    showStatusBar(`${done} created, ${failed} failed. Review errors above.`, 'error');
  }
}

function validateSettings() {
  const project = document.getElementById('m-project-key').value;
  const missing = [];
  if (!settings.url)   missing.push('JIRA URL');
  if (!settings.email) missing.push('email');
  if (!settings.token) missing.push('API token');
  if (!project)        missing.push('project key');
  if (missing.length) {
    showStatusBar('JIRA account not connected.', 'error', 'Set it up here.');
    return false;
  }
  return true;
}

function setSubmitting(on) {
  document.getElementById('btn-submit-all').disabled = on;
  document.getElementById('btn-add-ticket').disabled = on;
}

function setTicketStatus(card, type, msg) {
  const el = card.querySelector('.ticket-status');
  el.className = `ticket-status ${type}`;
  if (type === 'loading') {
    el.innerHTML = `<span class="spinner"></span>${msg}`;
  } else if (type === 'success') {
    el.innerHTML = msg;
  } else {
    el.textContent = msg;
  }
}

function showStatusBar(msg, type, linkText = null) {
  const el = document.getElementById('status-bar');
  el.className = `status-bar ${type}`;
  if (linkText) {
    el.innerHTML = `${msg} <a href="#" style="color:inherit;font-weight:600;">${linkText}</a>`;
    el.querySelector('a').addEventListener('click', e => { e.preventDefault(); showView('settings'); });
  } else {
    el.textContent = msg;
  }
}


// ── Project search ─────────────────────────────────────────────────────────
let allProjects = [];
let fieldNameToKey = {};
const fieldOptionsCache = {}; // projectKey -> { fieldId -> allowedValues }, primed from Story createmeta
const prefetchPromises = {};  // projectKey -> Promise, so loadRequiredFields can await it

async function loadAllProjects() {
  if (!settings.url || !settings.email || !settings.token) return;
  const input = document.getElementById('m-project');
  input.placeholder = 'Loading projects…';
  input.disabled = true;

  try {
    let projects = [];
    let startAt = 0;
    const pageSize = 50;
    while (true) {
      const res = await jiraFetch(
        `${settings.url}/rest/api/3/project/search?maxResults=${pageSize}&startAt=${startAt}&orderBy=name`,
        settings.email, settings.token
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      projects = projects.concat(data.values || []);
      if (projects.length >= data.total || !(data.values || []).length) break;
      startAt += pageSize;
    }
    allProjects = projects;
    input.placeholder = 'Search projects…';
    input.disabled = false;
    initProjectSearch();

    if (settings.project) {
      const saved = allProjects.find(p => p.key === settings.project);
      if (saved) {
        input.value = `${saved.name} (${saved.key})`;
        document.getElementById('m-project-key').value = saved.key;
        document.getElementById('btn-clear-project').classList.remove('hidden');
        loadIssueTypes(saved.key);
      }
    }
  } catch (e) {
    input.placeholder = `Could not load projects: ${e.message}`;
    input.disabled = false;
  }
}

function initProjectSearch() {
  const input = document.getElementById('m-project');
  const hidden = document.getElementById('m-project-key');
  const list   = document.getElementById('project-suggestions');
  let activeIndex = -1;

  function showFiltered(query) {
    const q = query.toLowerCase();
    const matches = q
      ? allProjects.filter(p => p.key.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      : allProjects;

    list.innerHTML = '';
    activeIndex = -1;

    if (!matches.length) {
      const li = document.createElement('li');
      li.className = 'no-results';
      li.textContent = 'No projects found';
      list.appendChild(li);
    } else {
      matches.forEach(p => {
        const li = document.createElement('li');
        li.textContent = `${p.name} (${p.key})`;
        li.addEventListener('mousedown', e => {
          e.preventDefault();
          input.value = `${p.name} (${p.key})`;
          hidden.value = p.key;
          list.classList.add('hidden');
          syncClearBtn();
          loadIssueTypes(p.key);
        });
        list.appendChild(li);
      });
    }
    list.classList.remove('hidden');
  }

  const clearBtn = document.getElementById('btn-clear-project');
  function syncClearBtn() {
    clearBtn.classList.toggle('hidden', !input.value);
  }
  clearBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    input.value = '';
    hidden.value = '';
    resetIssueTypes();
    clearRequiredFields();
    list.classList.add('hidden');
    syncClearBtn();
    input.focus();
  });

  input.addEventListener('focus', () => showFiltered(input.value));
  input.addEventListener('input', () => { hidden.value = ''; resetIssueTypes(); clearRequiredFields(); syncClearBtn(); showFiltered(input.value); });
  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));

  input.addEventListener('keydown', e => {
    const items = list.querySelectorAll('li:not(.no-results)');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      items[activeIndex].dispatchEvent(new MouseEvent('mousedown'));
      return;
    } else if (e.key === 'Escape') {
      list.classList.add('hidden');
      return;
    }
    items.forEach((li, i) => li.classList.toggle('active', i === activeIndex));
    if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
  });

  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
}

// ── Issue type loader ──────────────────────────────────────────────────────
function resetIssueTypes() {
  const sel = document.getElementById('m-issuetype');
  sel.innerHTML = '<option value="">— Select a project first —</option>';
  sel.disabled = true;
  clearRequiredFields();
}

async function loadIssueTypes(projectKey, preselectType = null) {
  const sel = document.getElementById('m-issuetype');
  sel.innerHTML = '<option value="">Loading…</option>';
  sel.disabled = true;

  try {
    const res = await jiraFetch(
      `${settings.url}/rest/api/3/project/${encodeURIComponent(projectKey)}`,
      settings.email, settings.token
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const types = (data.issueTypes || []).filter(t => !t.subtask);

    sel.innerHTML = '<option value="">— Select type —</option>';
    types.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.dataset.id = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    sel.disabled = false;

    // Prime fieldOptionsCache from Story createmeta; store promise so loadRequiredFields can await it
    prefetchPromises[projectKey] = prefetchAlwaysShowOptions(projectKey, types);
  } catch (e) {
    sel.innerHTML = `<option value="">Could not load: ${e.message}</option>`;
    sel.disabled = false;
  }
}

async function prefetchAlwaysShowOptions(projectKey, issueTypes) {
  const storyType = issueTypes.find(t => /story/i.test(t.name)) || issueTypes[0];
  if (!storyType) return;
  try {
    if (fieldDefsPromise) await fieldDefsPromise;
    let fieldsMap = {};
    let startAt = 0;
    while (true) {
      const res = await jiraFetch(
        `${settings.url}/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(storyType.id)}?maxResults=50&startAt=${startAt}`,
        settings.email, settings.token
      );
      if (!res.ok) break;
      const data = await res.json();
      Object.assign(fieldsMap, data.fields || {});
      const total = data.total ?? Object.keys(fieldsMap).length;
      if (Object.keys(fieldsMap).length >= total || !Object.keys(data.fields || {}).length) break;
      startAt += 50;
    }
    if (!fieldOptionsCache[projectKey]) fieldOptionsCache[projectKey] = {};
    for (const fieldId of ALWAYS_SHOW_FIELDS) {
      const entry = Object.entries(fieldsMap).find(([k, m]) =>
        k === fieldId || (fieldNameToKey[m?.name] || k) === fieldId
      );
      if (entry?.[1]?.allowedValues?.length) {
        fieldOptionsCache[projectKey][fieldId] = entry[1].allowedValues;
      }
    }
  } catch (_) {}
}



// ── Custom field options ───────────────────────────────────────────────────
async function fetchCustomFieldOptions(fieldId, projectKey = null) {
  try {
    const project   = projectKey ? allProjects.find(p => p.key === projectKey) : null;
    const projectId = project?.id ?? null;

    const ctxRes = await jiraFetch(
      `${settings.url}/rest/api/3/field/${fieldId}/context?maxResults=50`,
      settings.email, settings.token
    );
    if (ctxRes.ok) {
      const allContexts = (await ctxRes.json()).values || [];

      const fetchOptionsFromContexts = async (ctxList) => {
        let opts = [];
        for (const ctx of ctxList) {
          let startAt = 0;
          while (true) {
            const optRes = await jiraFetch(
              `${settings.url}/rest/api/3/field/${fieldId}/context/${ctx.id}/option?maxResults=100&startAt=${startAt}`,
              settings.email, settings.token
            );
            if (!optRes.ok) break;
            const optData = await optRes.json();
            const page = (optData.values || []).filter(o => !o.disabled).map(o => ({ id: o.id, value: o.value }));
            opts = opts.concat(page);
            if (opts.length >= (optData.total ?? opts.length) || !page.length) break;
            startAt += 100;
          }
        }
        return opts;
      };

      // Try project-scoped contexts first, then global contexts
      const projectScoped = projectId
        ? allContexts.filter(ctx => (ctx.projectIds || []).includes(projectId))
        : [];
      const globalContexts = allContexts.filter(ctx => ctx.isGlobalContext);

      if (projectScoped.length) {
        const opts = await fetchOptionsFromContexts(projectScoped);
        if (opts.length) return opts;
      }
      // Fall through to global contexts if project-scoped had no options
      const globalOpts = await fetchOptionsFromContexts(globalContexts);
      if (globalOpts.length) return globalOpts;
    }

    // Fallback: fetch all groups (teams) via the groups bulk API
    let groups = [], startAt = 0;
    while (true) {
      const res = await jiraFetch(
        `${settings.url}/rest/api/3/group/bulk?maxResults=50&startAt=${startAt}`,
        settings.email, settings.token
      );
      if (!res.ok) break;
      const data = await res.json();
      groups = groups.concat(data.values || []);
      if (groups.length >= (data.total ?? groups.length) || !(data.values || []).length) break;
      startAt += 50;
    }
    if (groups.length) return groups.map(g => ({ id: g.groupId || g.name, value: g.name }));

    return [];
  } catch (_) {
    return [];
  }
}

// ── Required fields ────────────────────────────────────────────────────────
const SKIP_FIELDS = new Set(['summary', 'description', 'project', 'issuetype', 'labels', 'attachment', 'reporter']);
const SKIP_NAMES  = new Set(['Summary', 'Description', 'Project', 'Issue Type', 'Labels', 'Attachment', 'Reporter']);
const FIELD_DEFAULTS       = { 'Does this Epic require Tagging/Digital Tracking?': 'No tracking required' };
const EPIC_REQUIRED_FIELDS = new Set();
const ALWAYS_SHOW_FIELDS   = new Set(['customfield_10225']);

function clearRequiredFields() {
  document.getElementById('required-fields').innerHTML = '';
}

async function loadRequiredFields(projectKey, issueTypeId, issueTypeName = '') {
  const container = document.getElementById('required-fields');
  container.innerHTML = '<p class="hint" style="padding:6px 0">Loading fields…</p>';
  if (fieldDefsPromise) await fieldDefsPromise;
  try {
    let fieldsMap = {};

    // Fetch all fields via newer paginated endpoint
    let startAt = 0;
    let fetchedOk = false;
    while (true) {
      const res = await jiraFetch(
        `${settings.url}/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}?maxResults=50&startAt=${startAt}`,
        settings.email, settings.token
      );
      if (!res.ok) break;
      fetchedOk = true;
      const data = await res.json();
      Object.assign(fieldsMap, data.fields || {});
      const total = data.total ?? Object.keys(fieldsMap).length;
      if (Object.keys(fieldsMap).length >= total || !Object.keys(data.fields || {}).length) break;
      startAt += 50;
    }

    if (!fetchedOk) {
      // Fallback to older endpoint
      const res2 = await jiraFetch(
        `${settings.url}/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&issuetypeIds=${encodeURIComponent(issueTypeId)}&expand=projects.issuetypes.fields`,
        settings.email, settings.token
      );
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      const data2 = await res2.json();
      fieldsMap = data2.projects?.[0]?.issuetypes?.[0]?.fields || {};
    }

    const fields = Object.entries(fieldsMap)
      .filter(([key, meta]) => {
        const mappedKey    = fieldNameToKey[meta.name] || key;
        const isAlwaysShow = ALWAYS_SHOW_FIELDS.has(key) || ALWAYS_SHOW_FIELDS.has(mappedKey);
        return (meta.required || isAlwaysShow)
          && !SKIP_FIELDS.has(key)
          && !SKIP_FIELDS.has(meta.key)
          && !SKIP_NAMES.has(meta.name);
      });

    // Wait for Story prefetch to finish so cache is populated before we use it
    if (prefetchPromises[projectKey]) await prefetchPromises[projectKey];

    // Ensure always-show fields appear; use cached options (from Story) when available
    for (const fieldId of ALWAYS_SHOW_FIELDS) {
      const idx = fields.findIndex(([k, m]) =>
        k === fieldId || fieldNameToKey[m.name] === fieldId
      );
      const cached = fieldOptionsCache[projectKey]?.[fieldId];
      if (idx !== -1) {
        // Already in fields — override allowedValues with cached version if we have one
        if (cached?.length) {
          fields[idx] = [fields[idx][0], { ...fields[idx][1], allowedValues: cached }];
        }
      } else {
        // Not in fields — add it
        const entry = Object.entries(fieldsMap).find(([k, m]) =>
          k === fieldId || fieldNameToKey[m.name] === fieldId
        );
        if (entry) {
          const meta = cached?.length ? { ...entry[1], allowedValues: cached } : entry[1];
          fields.push([entry[0], meta]);
        } else if (cached?.length) {
          // Not in this issue type's createmeta, but Story requires it — add with cached options
          const name = Object.keys(fieldNameToKey).find(n => fieldNameToKey[n] === fieldId) || fieldId;
          fields.push([fieldId, { name, required: true, schema: { type: 'option' }, allowedValues: cached }]);
        }
      }
    }

    container.innerHTML = '';
    if (!fields.length) return;

    const heading = document.createElement('p');
    heading.className = 'required-fields-heading';
    heading.textContent = 'Required Fields';
    container.appendChild(heading);

    fields.forEach(([key, meta]) => container.appendChild(renderRequiredField(key, meta)));
  } catch (e) {
    container.innerHTML = `<p class="hint" style="color:var(--red);padding:6px 0">Could not load fields: ${e.message}</p>`;
  }
}

function renderRequiredField(key, meta) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.dataset.fieldKey    = fieldNameToKey[meta.name] || key;
  wrap.dataset.fieldName   = meta.name || '';
  wrap.dataset.fieldSchema = JSON.stringify(meta.schema || {});

  const lbl = document.createElement('label');
  lbl.innerHTML = meta.required
    ? `${meta.name} <span class="required">*</span>`
    : meta.name;
  wrap.appendChild(lbl);

  const schema  = meta.schema || {};
  const allowed = meta.allowedValues || [];
  let input;


  const optionValue = (v) => schema.type === 'option' || schema.items === 'option'
    ? (v.value ?? v.name ?? v.id ?? '')
    : (v.id ?? v.name ?? v.value ?? '');

  if (allowed.length && schema.type !== 'array') {
    input = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = '— Select Option —';
    input.appendChild(blank);
    allowed.forEach(v => {
      const o = document.createElement('option');
      o.value = optionValue(v);
      o.textContent = v.name ?? v.value ?? v.id ?? '';
      input.appendChild(o);
    });
  } else if (allowed.length && schema.type === 'array') {
    input = document.createElement('select');
    input.multiple = true;
    input.size = Math.min(allowed.length, 4);
    allowed.forEach(v => {
      const o = document.createElement('option');
      o.value = optionValue(v);
      o.textContent = v.name ?? v.value ?? v.id ?? '';
      input.appendChild(o);
    });
  } else if (schema.type === 'number') {
    input = document.createElement('input');
    input.type = 'number';
  } else if (schema.type === 'date') {
    input = document.createElement('input');
    input.type = 'date';
  } else if (schema.type === 'datetime') {
    input = document.createElement('input');
    input.type = 'datetime-local';
  } else if (schema.type === 'user') {
    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Account ID';
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = meta.name;
  }

  input.dataset.fieldInput = '1';

  const defaultVal = FIELD_DEFAULTS[meta.name];
  if (defaultVal && input.tagName === 'SELECT') {
    const match = Array.from(input.options).find(o => o.textContent === defaultVal || o.value === defaultVal);
    if (match) input.value = match.value;
  } else if (defaultVal) {
    input.value = defaultVal;
  }

  wrap.appendChild(input);
  return wrap;
}

// ── Field definitions ──────────────────────────────────────────────────────
let fieldDefsPromise = null;

async function loadFieldDefinitions() {
  if (!settings.url || !settings.email || !settings.token) return;
  fieldDefsPromise = (async () => {
    try {
      const res = await jiraFetch(`${settings.url}/rest/api/3/field`, settings.email, settings.token);
      if (!res.ok) return;
      const fields = await res.json();
      fieldNameToKey = {};
      fields.forEach(f => { if (f.name && f.id) fieldNameToKey[f.name] = f.id; });
    } catch (_) {}
  })();
  return fieldDefsPromise;
}

// ── JIRA API ───────────────────────────────────────────────────────────────
function jiraFetch(url, email, token, options = {}) {
  const headers = {
    'Authorization': `Basic ${btoa(`${email}:${token}`)}`,
    'Accept': 'application/json',
    ...(options.headers || {}),
  };
  return fetch(url, { ...options, headers });
}

async function createIssue(title, description) {
  const projectKey = document.getElementById('m-project-key').value;
  const issueType  = document.getElementById('m-issuetype').value || 'Task';
  const labels = document.getElementById('global-team-input').value
    .split(',').map(l => l.trim()).filter(Boolean);
  const body = {
    fields: {
      project:   { key: projectKey },
      summary:   title,
      issuetype: { name: issueType },
      ...(labels.length ? { labels } : {}),
    },
  };

  document.querySelectorAll('#required-fields [data-field-key]').forEach(div => {
    const rawKey    = div.dataset.fieldKey;
    const fieldName = div.dataset.fieldName || '';
    const key       = fieldNameToKey[fieldName] || rawKey;
    const schema = JSON.parse(div.dataset.fieldSchema || '{}');
    const input  = div.querySelector('[data-field-input]');
    if (!input) return;

    const type  = schema.type;
    const items = schema.items;

    if (input.tagName === 'SELECT' && input.multiple) {
      const vals = Array.from(input.selectedOptions).map(o => o.value).filter(Boolean);
      if (!vals.length) return;
      body.fields[key] = vals.map(v => items === 'string' ? v : items === 'option' ? { value: v } : { id: v });
    } else if (input.tagName === 'SELECT') {
      if (!input.value) return;
      if (type === 'priority' || type === 'issuetype') body.fields[key] = { name: input.options[input.selectedIndex].textContent };
      else if (type === 'option') body.fields[key] = { value: input.value };
      else body.fields[key] = { id: input.value };
    } else if (type === 'number') {
      if (input.value === '') return;
      body.fields[key] = parseFloat(input.value);
    } else if (type === 'user') {
      if (!input.value.trim()) return;
      body.fields[key] = { accountId: input.value.trim() };
    } else {
      if (!input.value.trim()) return;
      body.fields[key] = input.value.trim();
    }
  });

  if (description) {
    body.fields.description = {
      type: 'doc', version: 1,
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: description }],
      }],
    };
  }

  const postIssue = async (payload) => jiraFetch(
    `${settings.url}/rest/api/3/issue`,
    settings.email, settings.token,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );

  let res = await postIssue(body);

  // Strip any fields Jira rejects and retry once
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    const err = await res.json().catch(() => ({}));
    const badFields = err.errors ? Object.keys(err.errors) : [];
    if (badFields.length) {
      badFields.forEach(k => delete body.fields[k]);
      res = await postIssue(body);
    }
    if (!res.ok) {
      const err2 = await res.json().catch(() => ({}));
      const fieldErrors = err2.errors ? Object.entries(err2.errors).map(([f, m]) => `${f}: ${m}`).join('; ') : '';
      const topError    = (err2.errorMessages || []).join('; ');
      throw new Error(fieldErrors || topError || err2.message || `HTTP ${res.status}`);
    }
  }

  const data = await res.json();
  return data.key;
}

async function resolveLinkType() {
  if (cachedLinkType) return cachedLinkType;

  const res = await jiraFetch(
    `${settings.url}/rest/api/3/issueLinkType`,
    settings.email, settings.token
  );
  if (!res.ok) return 'Dependency';

  const { issueLinkTypes = [] } = await res.json();
  // Find the type whose inward label is "is required by"
  const match = issueLinkTypes.find(lt => /is required by/i.test(lt.inward));
  cachedLinkType = match ? match.name : (issueLinkTypes[0]?.name ?? 'Dependency');
  return cachedLinkType;
}

async function linkIssue(issueKey, parentKey) {
  const linkTypeName = await resolveLinkType();
  const res = await jiraFetch(
    `${settings.url}/rest/api/3/issueLink`,
    settings.email, settings.token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:         { name: linkTypeName },
        outwardIssue: { key: parentKey },
        inwardIssue:  { key: issueKey },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Link failed (type: ${linkTypeName}): ${err.message || `HTTP ${res.status}`}`);
  }
}

async function uploadAttachment(issueKey, file) {
  const form = new FormData();
  form.append('file', file, file.name);

  const res = await jiraFetch(
    `${settings.url}/rest/api/3/issue/${issueKey}/attachments`,
    settings.email, settings.token,
    {
      method: 'POST',
      headers: { 'X-Atlassian-Token': 'no-check' },
      body: form,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Attachment failed: ${err.message || `HTTP ${res.status}`}`);
  }
}
