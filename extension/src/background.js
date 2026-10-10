// The only part of the extension that talks to the API, and the only one that sees the tokens.
// Requests come from here, not from the job site's page, so the API's CORS settings don't apply.
//
// Scripts running inside job sites are treated as untrusted (a compromised page could drive them), so:
// - tokens and server settings live in this worker's IndexedDB, which they can't read or change
//   (unlike chrome.storage.local, which every content script can);
// - they can only save a job, look jobs up and open the sign-in page. Signing in and out, and
//   reading or changing settings, are only accepted from the extension's own pages.

import { DEFAULT_SETTINGS, errorText, serverUrlProblem } from './shared.js';

// Versions before 0.2 kept the tokens in chrome.storage.local.
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove(['access', 'refresh', 'user', 'saved', 'apiUrl', 'appUrl']));

// ---------------------------------------------------------------------------
// Storage: a small key-value store in IndexedDB

let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('interview-analyzer', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function kv(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = run(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** { access, refresh, user } when signed in, {} otherwise. */
const getSession = async () => (await kv('readonly', (s) => s.get('session'))) ?? {};
const setSession = (session) => kv('readwrite', (s) => s.put(session, 'session'));
const clearSession = () => kv('readwrite', (s) => s.delete('session'));

const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...((await kv('readonly', (s) => s.get('settings'))) ?? {}) });

// Tabs with a save pop-up waiting for a sign-in, told when it happens. Kept in session storage,
// which content scripts can't read and which empties when the browser closes.
const getWaitingTabs = async () => (await chrome.storage.session.get({ waitingTabs: [] })).waitingTabs;
async function addWaitingTab(tabId) {
  const tabs = await getWaitingTabs();
  if (!tabs.includes(tabId)) await chrome.storage.session.set({ waitingTabs: [...tabs, tabId] });
}

// ---------------------------------------------------------------------------
// API

class SignedOut extends Error {
  constructor() {
    super('Sign in to save jobs to Interview Analyzer.');
  }
}

let refreshing = null;

/** Gets a new access token. Shares one refresh between requests that fail at the same time. */
function refreshAccess() {
  refreshing ??= (async () => {
    const session = await getSession();
    if (!session.refresh) return false;
    const { apiUrl } = await getSettings();
    try {
      const res = await fetch(`${apiUrl}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: session.refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      await setSession({ ...session, access: data.access, refresh: data.refresh ?? session.refresh });
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Calls the API. Signed-in calls use the stored access token, or `token` when given (used while signing
 * in, before anything is stored), and refresh it once on a 401.
 */
async function request(path, { method = 'GET', body, auth = true, token } = {}, retried = false) {
  const { apiUrl } = await getSettings();
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const access = token ?? (await getSession()).access;
    if (!access) throw new SignedOut();
    headers.Authorization = `Bearer ${access}`;
  }

  let res;
  try {
    res = await fetch(`${apiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error(`Can't reach Interview Analyzer at ${apiUrl}. Is the server running?`);
  }

  if (res.status === 401 && auth) {
    if (token) throw new SignedOut();
    if (!retried && (await refreshAccess())) return request(path, { method, body, auth }, true);
    await clearSession();
    throw new SignedOut();
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorText(data) || `Request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------------------
// Messages

/** What scripts inside job sites may ask for. */
const contentHandlers = {
  /** Where the app is, for "Open it" links, and whether saving will work. */
  async config() {
    const [{ appUrl }, session] = await Promise.all([getSettings(), getSession()]);
    return { appUrl, signedIn: Boolean(session.refresh) };
  },

  /** The application already saved for this job link, or null. */
  async find({ jobUrl }) {
    if (typeof jobUrl !== 'string' || !jobUrl) return { app: null };
    const apps = await request(`/applications/?job_url=${encodeURIComponent(jobUrl)}`);
    return { app: apps[0] ?? null };
  },

  /** Which of these job links are saved: { matches: { url: id } }. */
  async lookup({ jobUrls }) {
    const urls = [...new Set((Array.isArray(jobUrls) ? jobUrls : []).filter((u) => typeof u === 'string' && u))];
    const matches = {};
    for (let i = 0; i < urls.length; i += 100) {
      const res = await request('/applications/lookup/', { method: 'POST', body: { job_urls: urls.slice(i, i + 100) } });
      Object.assign(matches, res.matches);
    }
    return { matches };
  },

  async save({ application }) {
    const app = await request('/applications/', { method: 'POST', body: application });
    return { app };
  },

  /** The pop-up in this tab is waiting for a sign-in: tell it when one happens (from anywhere). */
  async waitForSignIn(_message, sender) {
    if (sender.tab) await addWaitingTab(sender.tab.id);
    return {};
  },

  /** Signing in happens on the extension's own page, never inside the job site. */
  async openSignIn(_message, sender) {
    if (sender.tab) await addWaitingTab(sender.tab.id);
    await chrome.tabs.create({
      url: chrome.runtime.getURL('popup/popup.html?signin=1'),
      ...(sender.tab && { openerTabId: sender.tab.id, index: sender.tab.index + 1 }),
    });
    return {};
  },
};

/** Only for the extension's own pages (the toolbar popup and the sign-in page). */
const pageHandlers = {
  async status() {
    const [{ user }, settings] = await Promise.all([getSession(), getSettings()]);
    return { user: user ?? null, ...settings };
  },

  async login({ username, password }) {
    const tokens = await request('/auth/token/', { method: 'POST', body: { username, password }, auth: false });
    const me = await request('/auth/me/', { token: tokens.access });
    // Stored only once both calls worked, so a failure can't leave half a session behind.
    const user = { name: me.first_name || me.username, email: me.email };
    await setSession({ access: tokens.access, refresh: tokens.refresh, user });
    // Save pop-ups waiting for this carry on (and their pages' "Saved" marks refresh). Other tabs
    // re-check their marks when they're next looked at.
    const waiting = await getWaitingTabs();
    await chrome.storage.session.set({ waitingTabs: [] });
    waiting.forEach((tabId) => chrome.tabs.sendMessage(tabId, { type: 'signed-in' }).catch(() => {}));
    return { user };
  },

  async logout() {
    await clearSession();
    return {};
  },

  async saveSettings({ apiUrl, appUrl }) {
    const problem = serverUrlProblem(apiUrl) || serverUrlProblem(appUrl);
    if (problem) throw new Error(problem);
    const before = await getSettings();
    await kv('readwrite', (s) => s.put({ apiUrl, appUrl }, 'settings'));
    if (apiUrl !== before.apiUrl) await clearSession(); // the tokens belong to the old server
    return {};
  },
};

const isExtensionPage = (sender) => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handlers = isExtensionPage(sender) ? { ...contentHandlers, ...pageHandlers } : contentHandlers;
  const handler = Object.hasOwn(handlers, message?.type) ? handlers[message.type] : null;
  if (!handler) return false;
  handler(message, sender).then(
    (data) => sendResponse({ ok: true, ...data }),
    (err) => sendResponse({ ok: false, signedOut: err instanceof SignedOut, error: err.message }),
  );
  return true; // replies asynchronously
});
