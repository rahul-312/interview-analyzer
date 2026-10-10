import { ask, getSettings } from '../shared.js';

const $ = (id) => document.getElementById(id);

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
  const { user, appUrl } = status;
  $('signin').hidden = Boolean(user);
  $('account').hidden = !user;
  if (user) {
    $('initials').textContent = initialsOf(user.name);
    $('name').textContent = user.name;
    $('email').textContent = user.email ?? '';
  }
  $('open-app').href = appUrl;

  const settings = await getSettings();
  $('settings').apiUrl.value = settings.apiUrl;
  $('settings').appUrl.value = settings.appUrl;
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
  render();
});

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

  // The worker can only call servers it has permission for. Ask now, while the click still counts.
  const granted = await chrome.permissions.request({ origins: [`${new URL(apiUrl).origin}/*`] });
  if (!granted) return showError(`The extension needs permission to reach ${new URL(apiUrl).origin}.`);

  const changed = apiUrl !== (await getSettings()).apiUrl;
  await chrome.storage.local.set({ apiUrl, appUrl });
  if (changed) await ask('logout'); // tokens belong to the old server
  render();
});

render();
