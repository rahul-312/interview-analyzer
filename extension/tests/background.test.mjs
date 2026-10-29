// Who may ask the background worker for what, and which server addresses are accepted.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const EXTENSION_ID = 'abcdefghijklmnop';
const BASE = `chrome-extension://${EXTENSION_ID}/`;
let listener = null;

globalThis.chrome = {
  runtime: {
    id: EXTENSION_ID,
    getURL: (path) => BASE + path,
    onInstalled: { addListener() {} },
    onMessage: { addListener: (fn) => (listener = fn) },
  },
  storage: {
    local: { remove: async () => {} },
    session: {
      data: {},
      async get(defaults) {
        return { ...defaults, ...this.data };
      },
      async set(values) {
        Object.assign(this.data, values);
      },
    },
  },
};

await import('../src/background.js');
const { serverUrlProblem } = await import('../src/shared.js');

/** Sends a message as `sender`. Returns whether the worker took it (it replies later if so). */
const send = (message, sender) => listener(message, sender, () => {});

/** Sends a message as `sender` and waits for the reply. */
const ask = (message, sender) => new Promise((resolve) => assert.equal(listener(message, sender, resolve), true));

const jobSite = { id: EXTENSION_ID, url: 'https://www.naukri.com/backend-jobs', tab: { id: 7, index: 0 } };
const popup = { id: EXTENSION_ID, url: `${BASE}popup/popup.html` };
const otherExtension = { id: 'zzzzzzzzzzzzzzzz', url: 'chrome-extension://zzzzzzzzzzzzzzzz/x.html' };

test('scripts on job sites cannot sign in, sign out, read the session or change settings', () => {
  for (const type of ['login', 'logout', 'status', 'saveSettings']) {
    assert.equal(send({ type, username: 'a', password: 'b' }, jobSite), false, type);
  }
});

test('nothing outside this extension is answered, and unknown messages are ignored', () => {
  assert.equal(send({ type: 'config' }, otherExtension), false);
  assert.equal(send({ type: 'toString' }, popup), false);
  assert.equal(send({ type: 'nope' }, popup), false);
});

test('only https servers are accepted, apart from this computer', () => {
  assert.equal(serverUrlProblem('https://ia.example.com/api'), '');
  assert.equal(serverUrlProblem('http://localhost:8000/api'), '');
  assert.equal(serverUrlProblem('http://127.0.0.1:3000'), '');
  assert.match(serverUrlProblem('http://ia.example.com/api'), /https/);
  assert.match(serverUrlProblem('javascript:alert(1)'), /https/);
  assert.match(serverUrlProblem('not a url'), /full address/);
  // Not in the manifest's host permissions, so requests to it would fail.
  assert.match(serverUrlProblem('http://[::1]:8000/api'), /https/);
});

test('tabs waiting for sign-in are remembered once each, even when they register at the same time', async () => {
  // Slow storage, so the registrations overlap.
  const { get, set } = chrome.storage.session;
  chrome.storage.session.get = async (d) => (await new Promise((r) => setTimeout(r, 5)), get.call(chrome.storage.session, d));
  chrome.storage.session.set = async (v) => (await new Promise((r) => setTimeout(r, 5)), set.call(chrome.storage.session, v));
  const otherTab = { ...jobSite, tab: { id: 8, index: 1 } };
  const replies = await Promise.all([
    ask({ type: 'waitForSignIn' }, jobSite),
    ask({ type: 'waitForSignIn' }, otherTab),
    ask({ type: 'waitForSignIn' }, jobSite),
  ]);
  assert.deepEqual(replies, [{ ok: true }, { ok: true }, { ok: true }]);
  assert.deepEqual(chrome.storage.session.data.waitingTabs, [7, 8]);
});
