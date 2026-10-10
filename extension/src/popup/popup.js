// The toolbar popup. Opened with ?signin=1 in a tab, it's also the sign-in page the in-page dialog
// sends people to, since passwords are only ever typed into the extension's own pages.

import { ask, serverUrlProblem } from '../shared.js';

const $ = (id) => document.getElementById(id);
const signInPage = new URLSearchParams(location.search).has('signin');
if (signInPage) document.body.classList.add('page');

const showError = (message) => {
  $('error').textContent = message ?? '';
  $('error').hidden = !message;
};

const initialsOf = (name) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

async function render() {
  const status = await ask('status');
  if (!status.ok) return showError(status.error);
  const { user, apiUrl, appUrl } = status;
  $('signin').hidden = Boolean(user);
  $('account').hidden = !user || signInPage;
  $('signed-in').hidden = !user || !signInPage;
  if (user) {
    $('initials').textContent = initialsOf(user.name);
    $('name').textContent = user.name;
    $('email').textContent = user.email ?? '';
  }
  $('open-app').href = appUrl;
  $('settings').apiUrl.value = apiUrl;
  $('settings').appUrl.value = appUrl;
}

/** On the sign-in page: go back to the job site's tab it was opened from, and close this one. */
async function returnToJob() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.openerTabId !== undefined) await chrome.tabs.update(tab.openerTabId, { active: true }).catch(() => {});
  if (tab) chrome.tabs.remove(tab.id);
}

$('signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const submit = form.querySelector('button');
  submit.disabled = true;
  showError('');
  const res = await ask('login', { username: form.username.value.trim(), password: form.password.value });
  submit.disabled = false;
  if (!res.ok) return showError(res.error);
  form.reset();
  if (signInPage) return returnToJob();
  render();
});

$('back').addEventListener('click', returnToJob);

$('signout').addEventListener('click', async () => {
  await ask('logout');
  render();
});

// Saves the job on the current tab: loads the page scripts there (the click allows it), then opens the pop-up.
$('save-page').addEventListener('click', async () => {
  showError('');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/sites.js', 'content/ui.js', 'content/content.js'],
    });
    await chrome.tabs.sendMessage(tab.id, { type: 'open-page' });
    window.close();
  } catch {
    showError("Can't save from this page. Open the job's page on the job site and try again.");
  }
});

$('settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const trim = (url) => url.trim().replace(/\/+$/, '');
  const apiUrl = trim(e.target.apiUrl.value);
  const appUrl = trim(e.target.appUrl.value);
  const problem = serverUrlProblem(apiUrl) || serverUrlProblem(appUrl);
  if (problem) return showError(problem);

  // The worker can only call servers it has permission for. Ask now, while the click still counts.
  // (localhost is always allowed, so this only asks for https servers.)
  const origin = new URL(apiUrl).origin;
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
  if (!granted) return showError(`The extension needs permission to reach ${origin}.`);

  const res = await ask('saveSettings', { apiUrl, appUrl });
  if (!res.ok) return showError(res.error);
  render();
});

render();
