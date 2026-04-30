import { WsClient } from './ws-client';

const TOKEN_KEY = 'cmb_token';

interface Thread {
  id: string;
  title?: string;
  status: string;
}

interface ApprovalRequest {
  requestId: string;
  method: string;
  params?: Record<string, unknown>;
}

let ws: WsClient | null = null;
let currentThreadId: string | null = null;
const approvals: Map<string, ApprovalRequest> = new Map();

// --- DOM refs ---
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const pairingView = $('#pairing-view');
const threadListView = $('#thread-list-view');
const threadDetailView = $('#thread-detail-view');
const inputBar = $('#input-bar');
const statusDot = $('#status-dot');
const pairingCode = $('#pairing-code') as HTMLInputElement;
const pairingError = $('#pairing-error');
const pairBtn = $('#pair-btn') as HTMLButtonElement;
const threadList = $('#thread-list');
const threadListEmpty = $('#thread-list-empty');
const threadTitle = $('#thread-title');
const messagesDiv = $('#messages');
const approvalCards = $('#approval-cards');
const messageInput = $('#message-input') as HTMLInputElement;
const sendBtn = $('#send-btn') as HTMLButtonElement;
const backBtn = $('#back-btn');
const interruptBtn = $('#interrupt-btn');

async function resolveWsUrl(): Promise<string> {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    const res = await fetch(`${window.location.protocol}//${window.location.host}/api/config`);
    const config = await res.json() as { webSocketPort?: number };
    return `${protocol}//${window.location.hostname}:${config.webSocketPort || 8765}`;
  } catch {
    return `${protocol}//${window.location.hostname}:8765`;
  }
}

// --- View management ---
function showView(view: 'pairing' | 'threads' | 'detail') {
  pairingView.classList.toggle('active', view === 'pairing');
  threadListView.classList.toggle('active', view === 'threads');
  threadDetailView.classList.toggle('active', view === 'detail');
  inputBar.style.display = view === 'detail' ? 'flex' : 'none';
}

// --- Pairing flow ---
async function handlePair() {
  const code = pairingCode.value.trim();
  if (code.length !== 6) {
    pairingError.textContent = 'Enter a 6-digit code';
    return;
  }

  pairBtn.disabled = true;
  pairingError.textContent = '';

  try {
    // Exchange pairing code for a device token via HTTP API
    const apiBase = `${window.location.protocol}//${window.location.host}`;
    const verifyRes = await fetch(`${apiBase}/api/pairing/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!verifyRes.ok) {
      const body = await verifyRes.json().catch(() => ({ error: 'Verification failed' }));
      throw new Error(body.error || `Pairing failed (${verifyRes.status})`);
    }

    const { token } = await verifyRes.json() as { token: string };

    // Connect WebSocket with the verified token
    const wsUrl = await resolveWsUrl();

    ws = new WsClient(wsUrl);
    setupWsHandlers();
    await ws.connect(token);

    localStorage.setItem(TOKEN_KEY, token);

    showView('threads');
    loadThreadList();
  } catch (err) {
    pairingError.textContent = err instanceof Error ? err.message : 'Connection failed';
  } finally {
    pairBtn.disabled = false;
  }
}

// --- WebSocket handlers ---
function setupWsHandlers() {
  if (!ws) return;

  ws.onMessage((msg) => {
    switch (msg.type) {
      case 'event':
        handleEvent(msg.event as Record<string, unknown>);
        break;
      case 'disconnected':
        statusDot.className = 'dot disconnected';
        break;
      case 'pong':
        break;
    }
  });
}

function handleEvent(event: Record<string, unknown>) {
  const type = event.type as string;

  if (type === 'approval/request') {
    const content = event.content as Record<string, unknown>;
    if (content) {
      const req: ApprovalRequest = {
        requestId: content.requestId as string,
        method: content.method as string,
        params: content.params as Record<string, unknown> | undefined,
      };
      approvals.set(req.requestId, req);
      renderApprovals();
    }
  }

  if (type === 'item/agentMessage/delta' || type === 'item/completed' ||
      type === 'turn/started' || type === 'turn/completed') {
    // Refresh messages if we're viewing this thread
    const threadId = event.threadId as string;
    if (threadId && threadId === currentThreadId) {
      appendEventMessage(event);
    }
  }
}

function appendEventMessage(event: Record<string, unknown>) {
  const type = event.type as string;
  const content = event.content as string | undefined;
  const delta = event.delta as string | undefined;

  if (delta) {
    // Append to last assistant message or create new one
    let lastMsg = messagesDiv.querySelector('.message.assistant:last-child') as HTMLElement | null;
    if (!lastMsg || lastMsg.dataset.complete === 'true') {
      lastMsg = document.createElement('div');
      lastMsg.className = 'message assistant';
      messagesDiv.appendChild(lastMsg);
    }
    lastMsg.textContent += delta;
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  if (type === 'item/completed' && content) {
    const msg = document.createElement('div');
    msg.className = 'message assistant';
    msg.dataset.complete = 'true';
    msg.textContent = content;
    messagesDiv.appendChild(msg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  if (type === 'turn/completed') {
    const msg = document.createElement('div');
    msg.className = 'message system';
    msg.textContent = 'Turn completed';
    messagesDiv.appendChild(msg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
}

// --- Thread list ---
async function loadThreadList() {
  if (!ws?.connected) return;
  statusDot.className = 'dot connected';

  try {
    const data = await ws.send('list') as { items?: Thread[] } | undefined;
    const threads = data?.items || [];
    threadList.innerHTML = '';
    threadListEmpty.style.display = threads.length === 0 ? 'block' : 'none';

    for (const t of threads) {
      const item = document.createElement('div');
      item.className = 'list-item';
      const statusClass = t.status === 'active' ? 'active' : t.status === 'completed' ? 'completed' : 'default';
      item.innerHTML = `
        <div>
          <div class="title">${escapeHtml(t.title || t.id)}</div>
          <div class="meta">${t.id}</div>
        </div>
        <span class="status ${statusClass}">${t.status}</span>
      `;
      item.onclick = () => openThread(t);
      threadList.appendChild(item);
    }
  } catch (err) {
    threadList.innerHTML = `<div class="empty">Failed to load threads: ${err instanceof Error ? err.message : 'Unknown error'}</div>`;
  }
}

// --- Thread detail ---
async function openThread(thread: Thread) {
  if (!ws?.connected) return;

  currentThreadId = thread.id;
  threadTitle.textContent = thread.title || thread.id;
  messagesDiv.innerHTML = '<div class="message system">Loading...</div>';
  approvalCards.innerHTML = '';
  showView('detail');

  try {
    await ws.send('open', { threadId: thread.id });
    messagesDiv.innerHTML = '<div class="message system">Thread opened. Send a message to start.</div>';
  } catch (err) {
    messagesDiv.innerHTML = `<div class="message system">Failed to open: ${err instanceof Error ? err.message : 'Unknown'}</div>`;
  }
}

// --- Send message ---
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !ws?.connected || !currentThreadId) return;

  messageInput.value = '';

  // Add user message to UI
  const userMsg = document.createElement('div');
  userMsg.className = 'message user';
  userMsg.textContent = text;
  messagesDiv.appendChild(userMsg);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  try {
    await ws.send('send', { threadId: currentThreadId, text });
  } catch (err) {
    const errMsg = document.createElement('div');
    errMsg.className = 'message system';
    errMsg.textContent = `Failed: ${err instanceof Error ? err.message : 'Unknown'}`;
    messagesDiv.appendChild(errMsg);
  }
}

// --- Interrupt ---
async function interruptTurn() {
  if (!ws?.connected || !currentThreadId) return;
  try {
    await ws.send('interrupt', { threadId: currentThreadId });
    const msg = document.createElement('div');
    msg.className = 'message system';
    msg.textContent = 'Interrupted';
    messagesDiv.appendChild(msg);
  } catch (err) {
    // ignore
  }
}

// --- Approvals ---
function renderApprovals() {
  approvalCards.innerHTML = '';
  for (const [id, req] of approvals) {
    const card = document.createElement('div');
    card.className = 'approval-card';
    const label = req.method.replace(/.*\//, '').replace(/([A-Z])/g, ' $1').trim();
    const detail = req.params
      ? JSON.stringify(req.params).slice(0, 200)
      : 'No details';
    card.innerHTML = `
      <div class="label">${escapeHtml(label)}</div>
      <div class="detail">${escapeHtml(detail)}</div>
      <div class="actions">
        <button class="btn primary" data-id="${id}" data-decision="approve">Approve</button>
        <button class="btn danger" data-id="${id}" data-decision="reject">Reject</button>
      </div>
    `;
    approvalCards.appendChild(card);
  }

  // Wire up buttons
  approvalCards.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = (btn as HTMLElement).dataset.id!;
      const decision = (btn as HTMLElement).dataset.decision!;
      handleApprovalDecision(rid, decision === 'approve');
    });
  });
}

async function handleApprovalDecision(requestId: string, approved: boolean) {
  if (!ws?.connected) return;
  try {
    await ws.send('approve', { approvalRequestId: requestId, approved });
    approvals.delete(requestId);
    renderApprovals();
  } catch (err) {
    // ignore
  }
}

// --- Helpers ---
function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// --- Event listeners ---
pairBtn.addEventListener('click', handlePair);
pairingCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') handlePair(); });
backBtn.addEventListener('click', () => {
  currentThreadId = null;
  showView('threads');
  loadThreadList();
});
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
interruptBtn.addEventListener('click', interruptTurn);

// --- Init ---
async function init() {
  const savedToken = localStorage.getItem(TOKEN_KEY);
  if (savedToken) {
    try {
      const wsUrl = await resolveWsUrl();
      ws = new WsClient(wsUrl);
      setupWsHandlers();
      await ws.connect(savedToken);
      showView('threads');
      loadThreadList();
      return;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  showView('pairing');
}

init();
