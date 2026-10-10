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
  storage: { local: { remove: async () => {} } },
};

await import('../src/background.js');
const { serverUrlProblem } = await import('../src/shared.js');

/** Sends a message as `sender`. Returns whether the worker took it (it replies later if so). */
const send = (message, sender) => listener(message, sender, () => {});

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
});
