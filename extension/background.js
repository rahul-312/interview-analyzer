// The only part of the extension that talks to the API. Content scripts and the popup send it
// messages; it holds the JWT tokens in chrome.storage.local and refreshes them when they expire.
// Requests come from here, not from the job site's page, so the API's CORS settings don't apply.

import { errorText, getSettings } from './shared.js';

class SignedOut extends Error {
  constructor() {
    super('Sign in to save jobs to Interview Analyzer.');
  }
}

const getSession = () => chrome.storage.local.get({ access: null, refresh: null, user: null });
const clearSession = () => chrome.storage.local.remove(['access', 'refresh', 'user']);

let refreshing = null;

/** Gets a new access token. Shares one refresh between requests that fail at the same time. */
function refreshAccess() {
  refreshing ??= (async () => {
    const { refresh } = await getSession();
    if (!refresh) return false;
    const { apiUrl } = await getSettings();
    try {
      const res = await fetch(`${apiUrl}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      await chrome.storage.local.set({ access: data.access, ...(data.refresh && { refresh: data.refresh }) });
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request(path, { method = 'GET', body, auth = true } = {}, retried = false) {
  const { apiUrl } = await getSettings();
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const { access } = await getSession();
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
    if (!retried && (await refreshAccess())) return request(path, { method, body, auth }, true);
    await clearSession();
    throw new SignedOut();
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorText(data) || `Request failed (${res.status})`);
  return data;
}

/** Remembers which job links are saved, so the page can mark them without asking the API. */
async function rememberSaved(jobUrl, appId) {
  if (!jobUrl) return;
  const { saved } = await chrome.storage.local.get({ saved: {} });
  if (appId) saved[jobUrl] = appId;
  else delete saved[jobUrl];
  await chrome.storage.local.set({ saved });
}

const handlers = {
  async status() {
    const [{ user }, settings] = await Promise.all([getSession(), getSettings()]);
    return { user, ...settings };
  },

  async login({ username, password }) {
    const tokens = await request('/auth/token/', { method: 'POST', body: { username, password }, auth: false });
    await chrome.storage.local.set({ access: tokens.access, refresh: tokens.refresh });
    const me = await request('/auth/me/');
    const user = { name: me.first_name || me.username, email: me.email };
    await chrome.storage.local.set({ user });
    return { user };
  },

  async logout() {
    await chrome.storage.local.remove(['access', 'refresh', 'user', 'saved']);
    return {};
  },

  /** The application already saved for this job link, or null. */
  async find({ jobUrl }) {
    const apps = await request(`/applications/?job_url=${encodeURIComponent(jobUrl)}`);
    const app = apps[0] ?? null;
    await rememberSaved(jobUrl, app?.id);
    return { app };
  },

  async save({ application }) {
    const app = await request('/applications/', { method: 'POST', body: application });
    await rememberSaved(app.job_url, app.id);
    return { app };
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler(message).then(
    (data) => sendResponse({ ok: true, ...data }),
    (err) => sendResponse({ ok: false, signedOut: err instanceof SignedOut, error: err.message }),
  );
  return true; // replies asynchronously
});
