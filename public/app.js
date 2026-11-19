import { offlineStore } from './offline.js';

const $ = (selector) => document.querySelector(selector);
const state = { workspace: null, socket: null, clientId: crypto.randomUUID(), dirty: false, conflict: null, cursor: null, reconnectDelay: 500, remoteEdit: false, revision: 0, saving: false, savePromise: null, loadToken: 0, offlineMode: false };
const sampleCode = {
  python: 'n = int(input())\nnums = list(map(int, input().split()))\ntarget = int(input())\n\nseen = {}\nfor i, value in enumerate(nums):\n    other = target - value\n    if other in seen:\n        print(seen[other], i)\n        break\n    seen[value] = i\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    int n, target;\n    cin >> n;\n    vector<int> nums(n);\n    for (int& value : nums) cin >> value;\n    cin >> target;\n\n    unordered_map<int, int> seen;\n    for (int i = 0; i < n; ++i) {\n        int other = target - nums[i];\n        if (seen.count(other)) {\n            cout << seen[other] << " " << i << "\\n";\n            return 0;\n        }\n        seen[nums[i]] = i;\n    }\n}\n'
};
const fallbackWorkspace = { id: 1, title: 'Starter workspace', language: 'python', code: sampleCode.python, version: 1 };
const fallbackProblems = [
  { id: 1, title: 'Two Sum', description: 'Read n, then n integers and a target. Print the two zero-based indices of a pair that sums to the target.', time_limit_ms: 2000, sample_input: '4\n2 7 11 15\n9\n', sample_output: '0 1\n' },
  { id: 2, title: 'Maximum Subarray Sum', description: 'Read n and n integers. Print the maximum sum of a non-empty contiguous subarray.', time_limit_ms: 2000, sample_input: '9\n-2 1 -3 4 -1 2 1 -5 4\n', sample_output: '6\n' },
  { id: 3, title: 'Valid Parentheses', description: 'Read one bracket string. Print YES if it is balanced, otherwise NO.', time_limit_ms: 2000, sample_input: '([]{})\n', sample_output: 'YES\n' },
  { id: 4, title: 'Binary Search', description: 'Read n, a sorted array, and a target. Print its zero-based index, or -1.', time_limit_ms: 2000, sample_input: '6\n-3 0 2 5 9 12\n5\n', sample_output: '3\n' },
  { id: 5, title: 'Shortest Path', description: 'Read an undirected unweighted graph, then source and target. Print the shortest distance, or -1.', time_limit_ms: 2000, sample_input: '5 5\n1 2\n2 3\n1 4\n4 5\n3 5\n1 5\n', sample_output: '2\n' }
];
const fallbackUsers = [
  { id: 1, username: 'arya', department: 'Systems' },
  { id: 4, username: 'noah', department: 'Applied Math' },
  { id: 7, username: 'inez', department: 'Product' }
];

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.hidden = true; }, 3200);
}

function connectionStatus(online, text) {
  const badge = $('#connection');
  badge.classList.toggle('online', online);
  badge.classList.toggle('offline', !online);
  badge.lastElementChild.textContent = text;
  if (!online) updateSaveState('Offline - Saved Locally', '');
}

function updateSaveState(text, className = '') {
  const element = $('#save-state');
  element.textContent = text;
  element.className = `save-state ${className}`;
  $('.sync-mark')?.classList.toggle('offline', text.startsWith('Offline'));
  const heading = $('#heading-save-state');
  if (heading) {
    heading.lastElementChild.textContent = text;
    heading.className = `heading-save ${className || (text.startsWith('Offline') ? 'offline' : '')}`;
  }
}

function updateEditorMetrics() {
  const editor = $('#code');
  if (!editor) return;
  const value = editor.value;
  const cursor = editor.selectionStart || 0;
  const lines = value.split('\n');
  const currentLine = value.slice(0, cursor).split('\n');
  $('#line-numbers').textContent = lines.map((_, index) => index + 1).join('\n');
  $('#line-numbers').scrollTop = editor.scrollTop;
  $('#editor-position').textContent = `Ln ${currentLine.length}, Col ${currentLine.at(-1).length + 1}`;
  $('#character-count').textContent = `${value.length.toLocaleString()} chars`;
}

function selectSidePanel(panelId) {
  for (const tab of document.querySelectorAll('.side-tab')) {
    const active = tab.dataset.panel === panelId;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  $('#problem-panel').hidden = panelId !== 'problem-panel';
  $('#output-panel').hidden = panelId !== 'output-panel';
}

function draftValue(pending = state.dirty) {
  return {
    workspaceId: Number(state.workspace.id),
    title: state.workspace.title,
    language: $('#language').value,
    code: $('#code').value,
    version: Number(state.workspace.version),
    pending
  };
}

async function saveLocal(pending = state.dirty) {
  if (!state.workspace) return;
  await offlineStore.save(draftValue(pending));
}

async function saveRemote() {
  if (!state.workspace || !state.dirty || state.conflict) return;
  if (state.saving) return state.savePromise;
  if (!navigator.onLine || state.socket?.readyState !== WebSocket.OPEN) {
    await saveLocal(true);
    updateSaveState('Offline - Saved Locally');
    return;
  }
  state.saving = true;
  const workspaceId = state.workspace.id;
  const revision = state.revision;
  const payload = {
    title: $('#workspace-select').selectedOptions[0]?.textContent || state.workspace.title,
    language: $('#language').value, code: $('#code').value, version: Number(state.workspace.version)
  };
  updateSaveState('Saving', 'pending');
  state.savePromise = (async () => {
    try {
      const latest = await api(`/api/workspaces/${workspaceId}`, {
        method: 'PUT', headers: { 'X-Client-Id': state.clientId }, body: JSON.stringify(payload)
      });
      if (state.workspace?.id !== workspaceId) return;
      state.offlineMode = false;
      $('#new-workspace').disabled = false;
      connectionStatus(true, 'Connected');
      state.workspace = latest;
      $('#workspace-heading').textContent = latest.title;
      $('#header-workspace-name').textContent = latest.title;
      $('#workspace-version').textContent = `v${latest.version}`;
      $('#heading-version').textContent = `v${latest.version}`;
      state.dirty = state.revision !== revision;
      await saveLocal(state.dirty);
      updateSaveState(state.dirty ? 'Unsaved changes' : 'Saved', state.dirty ? 'pending' : 'saved');
    } catch (error) {
      if (state.workspace?.id !== workspaceId) return;
      if (error.status === 409) {
        state.conflict = error.data.latest;
        $('#conflict').hidden = false;
        await saveLocal(true);
        updateSaveState('Conflict', 'pending');
        return;
      }
      state.offlineMode = true;
      $('#new-workspace').disabled = true;
      await saveLocal(true);
      connectionStatus(false, 'Local draft');
    } finally {
      state.saving = false;
      if (state.workspace?.id === workspaceId && state.dirty && state.revision !== revision && !state.conflict && navigator.onLine) {
        setTimeout(saveRemote, 0);
      }
    }
  })();
  return state.savePromise;
}

let saveTimer;
function scheduleSave() {
  state.dirty = true;
  state.revision += 1;
  updateSaveState('Unsaved changes', 'pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveLocal(true);
    await saveRemote();
  }, 450);
}

async function loadWorkspace(id) {
  const token = ++state.loadToken;
  if (state.workspace && state.dirty) {
    await saveLocal(true);
    if (navigator.onLine && state.socket?.readyState === WebSocket.OPEN && !state.conflict) await saveRemote();
  }
  if (state.savePromise) await state.savePromise;
  const draft = await offlineStore.get(id).catch(() => null);
  let workspace;
  try {
    workspace = await api(`/api/workspaces/${id}`);
    state.offlineMode = false;
    $('#new-workspace').disabled = false;
  } catch {
    state.offlineMode = true;
    $('#new-workspace').disabled = true;
    workspace = draft ? { id: Number(id), title: draft.title, language: draft.language, code: draft.code, version: draft.version || 1 } : { ...fallbackWorkspace, id: Number(id) };
    connectionStatus(false, 'Local draft');
  }
  if (token !== state.loadToken) return;
  const useDraft = Boolean(draft && (state.offlineMode || draft.pending));
  state.workspace = useDraft ? { ...workspace, version: draft.version || 1 } : workspace;
  state.conflict = null;
  $('#conflict').hidden = true;
  $('#workspace-select').value = String(id);
  $('#language').value = useDraft ? draft.language : workspace.language;
  $('#code').value = useDraft ? draft.code : workspace.code;
  state.dirty = Boolean(draft?.pending);
  $('#workspace-version').textContent = `v${state.workspace.version}`;
  $('#heading-version').textContent = `v${state.workspace.version}`;
  $('#workspace-heading').textContent = state.workspace.title;
  $('#header-workspace-name').textContent = state.workspace.title;
  $('#file-name').textContent = $('#language').value === 'cpp' ? 'main.cpp' : 'main.py';
  $('#editor-language').textContent = $('#language').value === 'cpp' ? 'C++17' : 'Python 3';
  $('#sidebar-language').textContent = $('#editor-language').textContent;
  updateEditorMetrics();
  updateSaveState(state.dirty || state.offlineMode ? 'Offline - Saved Locally' : 'Saved', state.dirty || state.offlineMode ? '' : 'saved');
  connectSocket(id);
  if (state.dirty && navigator.onLine) setTimeout(saveRemote, 0);
}

function connectSocket(roomId) {
  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close();
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws?room=${roomId}&clientId=${encodeURIComponent(state.clientId)}`);
  state.socket = socket;
  socket.onopen = () => {
    state.reconnectDelay = 500;
    connectionStatus(!state.offlineMode, state.offlineMode ? 'Local draft' : 'Connected');
    flushPending();
  };
  socket.onclose = () => {
    if (state.socket !== socket) return;
    connectionStatus(false, 'Offline - Saved Locally');
    saveLocal(true).catch(() => {});
    setTimeout(() => {
      if (state.workspace && state.socket === socket) connectSocket(state.workspace.id);
    }, state.reconnectDelay);
    state.reconnectDelay = Math.min(10000, state.reconnectDelay * 2);
  };
  socket.onerror = () => socket.close();
  socket.onmessage = (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'presence') $('#collaborators').textContent = `${message.count} collaborator${message.count === 1 ? '' : 's'}`;
    if (message.type === 'edit' && message.clientId !== state.clientId) {
      state.remoteEdit = true;
      $('#code').value = message.code;
      state.remoteEdit = false;
    }
    if (message.type === 'saved' && Number(message.workspace?.id) === Number(state.workspace?.id)) {
      if (state.dirty) {
        state.conflict = message.workspace;
        $('#conflict').hidden = false;
        saveLocal(true).catch(() => {});
        updateSaveState('Conflict', 'pending');
      } else {
        state.workspace = message.workspace;
        $('#code').value = message.workspace.code;
        $('#language').value = message.workspace.language;
        $('#file-name').textContent = message.workspace.language === 'cpp' ? 'main.cpp' : 'main.py';
        $('#editor-language').textContent = message.workspace.language === 'cpp' ? 'C++17' : 'Python 3';
        $('#sidebar-language').textContent = $('#editor-language').textContent;
        $('#workspace-version').textContent = `v${message.workspace.version}`;
        saveLocal(false).catch(() => {});
      }
    }
    if (message.type === 'verdict') showVerdict(message);
  };
}

async function flushPending() {
  if (!navigator.onLine || state.socket?.readyState !== WebSocket.OPEN || state.conflict) return;
  const drafts = await offlineStore.pending().catch(() => []);
  const draft = drafts.find((item) => item.workspaceId === Number(state.workspace?.id));
  if (draft) {
    state.dirty = true;
    await saveRemote();
  }
}

function showVerdict(verdict) {
  if (String(verdict.submission_id) !== $('#run-status').dataset.id) return;
  const status = $('#run-status');
  status.textContent = verdict.status;
  status.className = `status-badge ${verdict.status === 'ACCEPTED' ? 'accepted' : 'failed'}`;
  $('#output').textContent = `${verdict.message || verdict.status}\nExecution time: ${verdict.execTimeMs ?? verdict.exec_time_ms ?? 0} ms`;
  $('#output-time').textContent = `${verdict.execTimeMs ?? verdict.exec_time_ms ?? 0} ms`;
  selectSidePanel('output-panel');
  refreshSubmissions(true);
}

async function pollSubmission(id) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const result = await api(`/api/submissions/${id}`);
      if (result.status !== 'PENDING') {
        showVerdict({ submission_id: id, status: result.status, exec_time_ms: result.exec_time_ms });
        return;
      }
    } catch { return; }
  }
}

async function runCode() {
  const button = $('#run');
  selectSidePanel('output-panel');
  button.disabled = true;
  $('#run-status').textContent = 'Queued';
  $('#run-status').className = 'status-badge running';
  $('#output').textContent = 'Submitting code...';
  try {
    const result = await api('/api/submissions', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ user_id: Number($('#user').value), problem_id: Number($('#problem').value), language: $('#language').value, code: $('#code').value })
    });
    $('#run-status').dataset.id = String(result.submission_id);
    $('#run-status').textContent = `PENDING #${result.submission_id}`;
    $('#output').textContent = `Queued on ${result.worker_node || 'worker'}\nWaiting for verdict...`;
    await refreshSubmissions(true);
    pollSubmission(result.submission_id);
  } catch (error) {
    $('#run-status').textContent = 'Request failed';
    $('#run-status').className = 'status-badge failed';
    $('#output').textContent = state.offlineMode
      ? 'The runner needs a database connection. Your code is still saved in this browser.'
      : error.message;
  } finally { button.disabled = false; }
}

async function refreshSubmissions(reset = false) {
  if (reset) { state.cursor = null; $('#submission-rows').replaceChildren(); }
  const query = state.cursor ? `?cursor=${encodeURIComponent(state.cursor)}` : '';
  try {
    const page = await api(`/api/submissions${query}`);
    const body = $('#submission-rows');
    for (const item of page.items) {
      const row = document.createElement('tr');
      const verdict = document.createElement('td');
      verdict.className = `verdict ${item.status === 'ACCEPTED' ? 'accepted' : item.status === 'PENDING' ? 'pending' : 'failed'}`;
      verdict.textContent = item.status;
      for (const value of [verdict, item.problem_title, item.language, `${item.exec_time_ms} ms`, new Date(item.created_at).toLocaleString()]) {
        const cell = value instanceof HTMLElement ? value : document.createElement('td');
        if (!(value instanceof HTMLElement)) cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
    $('#empty-submissions').hidden = body.children.length > 0;
    state.cursor = page.nextCursor;
    $('#more-submissions').hidden = !state.cursor;
  } catch { /* The editor remains usable if history is unavailable. */ }
}

async function refreshLeaderboard() {
  const body = $('#leaderboard-rows');
  body.replaceChildren();
  try {
    const rows = await api('/api/leaderboard');
    for (const item of rows) {
      const row = document.createElement('tr');
      const values = [item.department_rank, item.username, item.department, item.problems_solved, `${item.total_time_ms} ms`];
      values.forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        if (index === 0) cell.className = 'rank-cell';
        row.append(cell);
      });
      body.append(row);
    }
    $('#empty-leaderboard').textContent = 'No leaderboard entries yet.';
    $('#empty-leaderboard').hidden = body.children.length > 0;
  } catch (error) {
    $('#empty-leaderboard').textContent = 'Leaderboard needs a database connection.';
    $('#empty-leaderboard').hidden = false;
    throw error;
  }
}

function fillSelect(select, rows, label) {
  select.replaceChildren();
  for (const row of rows) {
    const option = document.createElement('option');
    option.value = row.id;
    option.textContent = label(row);
    select.append(option);
  }
}

async function initialize() {
  let workspaces;
  let problems;
  let users;
  try {
    [workspaces, problems, users] = await Promise.all([
      api('/api/workspaces'), api('/api/submissions/problems'), api('/api/submissions/users')
    ]);
  } catch (error) {
    state.offlineMode = true;
    const drafts = await offlineStore.all().catch(() => []);
    workspaces = drafts.length
      ? drafts.map((draft) => ({ id: draft.workspaceId, title: draft.title || `Workspace ${draft.workspaceId}` }))
      : [fallbackWorkspace];
    problems = fallbackProblems;
    users = fallbackUsers;
    connectionStatus(false, 'Local draft');
    $('#new-workspace').disabled = true;
    $('#output').textContent = 'The database is not connected. Code stays in this browser until it reconnects.';
  }

  if (!workspaces?.length) workspaces = [fallbackWorkspace];
  problems ||= fallbackProblems;
  users ||= fallbackUsers;
  fillSelect($('#workspace-select'), workspaces, (item) => item.title);
  fillSelect($('#problem'), problems, (item) => item.title);
  fillSelect($('#user'), users, (item) => `${item.username} - ${item.department}`);
  $('#active-user').textContent = users[0]?.username?.slice(0, 1).toUpperCase() || 'U';

  $('#problem').addEventListener('change', () => {
    const selected = problems.find((item) => Number(item.id) === Number($('#problem').value));
    $('#problem-title').textContent = selected?.title || 'Problem';
    $('#problem-description').textContent = selected?.description || '';
    $('#limit-badge').textContent = `${(selected?.time_limit_ms || 2000) / 1000}s`;
    $('#sample-input').textContent = selected?.sample_input?.trimEnd() || 'Sample input is not available.';
    $('#sample-output').textContent = selected?.sample_output?.trimEnd() || 'Sample output is not available.';
    $('#sidebar-problem').textContent = selected?.title || 'None';
  });
  $('#problem').dispatchEvent(new Event('change'));
  $('#workspace-select').addEventListener('change', (event) => loadWorkspace(event.target.value).catch((error) => toast(error.message)));
  $('#language').addEventListener('change', () => {
    const language = $('#language').value;
    $('#file-name').textContent = language === 'cpp' ? 'main.cpp' : 'main.py';
    $('#editor-language').textContent = language === 'cpp' ? 'C++17' : 'Python 3';
    $('#sidebar-language').textContent = language === 'cpp' ? 'C++17' : 'Python 3';
    scheduleSave();
  });
  $('#code').addEventListener('input', () => {
    if (!state.remoteEdit && state.socket?.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ type: 'edit', code: $('#code').value, clientId: state.clientId }));
    }
    updateEditorMetrics();
    scheduleSave();
  });
  $('#code').addEventListener('scroll', updateEditorMetrics);
  $('#code').addEventListener('keyup', updateEditorMetrics);
  $('#code').addEventListener('click', updateEditorMetrics);
  $('#code').addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const input = event.currentTarget;
    input.setRangeText('    ', input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#run').addEventListener('click', runCode);
  $('#new-workspace').addEventListener('click', async () => {
    const title = `Workspace ${new Date().toLocaleDateString()}`;
    try {
      const created = await api('/api/workspaces', { method: 'POST', body: JSON.stringify({ title, language: 'python', code: sampleCode.python }) });
      const option = document.createElement('option');
      option.value = created.id;
      option.textContent = created.title;
      $('#workspace-select').append(option);
      await loadWorkspace(created.id);
    } catch (error) { toast(error.message); }
  });
  $('#reload-latest').addEventListener('click', () => {
    if (!state.conflict) return;
    state.workspace = state.conflict;
    $('#code').value = state.conflict.code;
    $('#language').value = state.conflict.language;
    $('#file-name').textContent = state.conflict.language === 'cpp' ? 'main.cpp' : 'main.py';
    state.dirty = false;
    state.revision += 1;
    state.conflict = null;
    $('#conflict').hidden = true;
    $('#workspace-version').textContent = `v${state.workspace.version}`;
    $('#heading-version').textContent = `v${state.workspace.version}`;
    updateEditorMetrics();
    saveLocal(false).catch(() => {});
    updateSaveState('Saved', 'saved');
  });
  $('#overwrite').addEventListener('click', async () => {
    if (!state.conflict) return;
    state.workspace = state.conflict;
    state.conflict = null;
    $('#conflict').hidden = true;
    state.dirty = true;
    await saveRemote();
  });
  $('#more-submissions').addEventListener('click', () => refreshSubmissions(false));
  $('#refresh-leaderboard').addEventListener('click', () => refreshLeaderboard().catch(() => toast('Leaderboard is unavailable while the database is offline.')));
  document.querySelectorAll('.view-tab').forEach((tab) => tab.addEventListener('click', async () => {
    document.querySelectorAll('.view-tab').forEach((item) => item.classList.toggle('active', item === tab));
    $('#editor-view').hidden = tab.dataset.view !== 'editor';
    $('#leaderboard-view').hidden = tab.dataset.view !== 'leaderboard';
    if (tab.dataset.view === 'leaderboard') await refreshLeaderboard().catch(() => toast('Leaderboard is unavailable while the database is offline.'));
  }));
  document.querySelectorAll('.side-tab').forEach((tab) => tab.addEventListener('click', () => selectSidePanel(tab.dataset.panel)));
  $('#user').addEventListener('change', (event) => { $('#active-user').textContent = event.target.selectedOptions[0]?.textContent.slice(0, 1).toUpperCase() || 'U'; });
  $('#sidebar-language').textContent = $('#language').value === 'cpp' ? 'C++17' : 'Python 3';
  $('#editor-language').textContent = $('#sidebar-language').textContent;
  await loadWorkspace(workspaces[0].id);
  await refreshSubmissions(true);
  setInterval(() => {
    if (state.offlineMode && state.dirty && navigator.onLine) saveRemote();
  }, 6000);
}

window.addEventListener('online', flushPending);
window.addEventListener('offline', () => connectionStatus(false, 'Offline - Saved Locally'));
initialize();
