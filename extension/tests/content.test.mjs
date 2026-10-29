// The page scripts together (sites.js, ui.js, content.js) on a job search page (Naukri markup), with the
// background worker faked: "Saved" marks, saving, and carrying on after signing in elsewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(`../src/content/${path}`, import.meta.url), 'utf8');
const SCRIPTS = ['sites.js', 'ui.js', 'content.js'].map(read);
const JOB_URL = 'https://www.naukri.com/job-listings-backend-engineer-acme-091025000111';

const CARD = `
  <div class="srp-jobtuple-wrapper"><div class="cust-job-tuple sjw__tuple">
    <div class="row1"><h2><a class="title" title="Backend Engineer" href="${JOB_URL}?src=jobsearchDesk">Backend Engineer</a></h2></div>
    <div class="row2"><a class="comp-name" title="Acme" href="#">Acme</a></div>
    <div class="row6"><span class="save-job-tag">Save</span></div>
  </div></div>`;

// A list shows more than one job (pages linking to just one get no card buttons).
const OTHER_CARD = CARD.replaceAll("091025000111", "091025000222").replaceAll("Backend Engineer", "SRE");

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A Naukri search page with the extension's scripts running. `worker(message)` answers what the
 * background worker would. Shadow roots are opened so the test can look inside them.
 */
function page(worker, { url = 'https://www.naukri.com/backend-jobs', body = CARD + OTHER_CARD, setup } = {}) {
  const dom = new JSDOM(`<body>${body}</body>`, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const listeners = [];
  w.chrome = {
    runtime: {
      sendMessage: async (message) => worker(message),
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
    storage: { local: { get: async (defaults) => defaults, set: async () => {} } },
  };
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function () {
    return attach.call(this, { mode: 'open' });
  };
  setup?.(w);
  SCRIPTS.forEach((script) => w.eval(script));

  const button = () => w.document.querySelector('[data-interview-analyzer]')?.shadowRoot?.querySelector('button');
  const dialog = () => w.document.querySelector('div[data-interview-analyzer]')?.shadowRoot;
  const broadcast = (message) => listeners.forEach((fn) => fn(message, {}, () => {}));
  return { w, button, dialog, broadcast };
}

const savedApp = { id: 9, company: 'Acme', role: 'Backend Engineer', date_applied: '2026-10-10', job_url: JOB_URL };

test('marks come from the app: a job saved elsewhere shows as saved', async () => {
  const { button } = page(async (m) => (m.type === 'lookup' ? { ok: true, matches: { [JOB_URL]: 9 } } : { ok: false }));
  await tick(50);
  assert.equal(button().textContent, '+ Track');
  await tick(450); // lookups are batched
  assert.equal(button().textContent, '✓ Saved');
});

test('a lookup that was already in flight when the job was saved does not undo the save', async () => {
  let answerLookup;
  const { button, dialog } = page(async (m) => {
    if (m.type === 'lookup') return new Promise((resolve) => (answerLookup = resolve));
    if (m.type === 'config') return { ok: true, appUrl: 'https://ia.example.com/app', signedIn: true };
    if (m.type === 'find') return { ok: true, app: null };
    if (m.type === 'save') return { ok: true, app: savedApp };
    return { ok: false };
  });
  await tick(500); // the lookup is now waiting for an answer
  assert.ok(answerLookup);

  button().click();
  await tick(20);
  dialog().querySelector('form').requestSubmit();
  await tick(20);
  assert.equal(button().textContent, '✓ Saved');
  // "Open it" keeps the path the app lives under.
  assert.equal(dialog().querySelector('a.btn.primary').href, 'https://ia.example.com/app/applications/9');

  answerLookup({ ok: true, matches: {} }); // stale: from before the save
  await tick(20);
  assert.equal(button().textContent, '✓ Saved');
});

test('a dialog waiting for sign-in carries on when told someone signed in, without a tab switch', async () => {
  let signedIn = false;
  const { button, dialog, broadcast } = page(async (m) => {
    if (m.type === 'config') return { ok: true, appUrl: 'https://ia.example.com', signedIn };
    if (m.type === 'find') return { ok: true, app: null };
    return { ok: false };
  });
  await tick(50);
  button().click();
  await tick(20);
  assert.equal(dialog().querySelector('h2').textContent, 'Sign in to Interview Analyzer');
  assert.equal(dialog().querySelector('input[type="password"]'), null); // never asks for it on the page

  signedIn = true; // e.g. from the toolbar popup; this tab never became hidden
  broadcast({ type: 'signed-in' });
  await tick(20);
  assert.equal(dialog().querySelector('h2').textContent, 'Add application');
  assert.equal(dialog().querySelector('input[name="company"]').value, 'Acme');
});

test('any site: a job page gets the floating "Save" button, other pages get none', async () => {
  const description = `<div class="job-description"><h2>Responsibilities</h2><p>${'Build and run our services. '.repeat(20)}</p></div>`;
  const job = page(async () => ({ ok: false }), {
    url: 'https://careers.example.com/jobs/42',
    body: `<main><h1>Platform Engineer</h1>${description}<a href="/apply">Apply now</a></main>`,
  });
  await tick(50);
  assert.equal(job.button()?.textContent, '+ Save to Interview Analyzer');

  const other = page(async () => ({ ok: false }), {
    url: 'https://news.example.com/2026/10/markets',
    body: `<main><h1>Markets today</h1>${description}<a href="/apply">Apply now</a></main>`,
  });
  await tick(50);
  assert.equal(other.button(), undefined);
});

test("card buttons go in a layer of their own, never inside the site's list", async () => {
  const { w } = page(async () => ({ ok: false }));
  await tick(50);
  const layer = w.document.querySelector('[data-interview-analyzer-layer]');
  assert.equal(layer.parentElement, w.document.documentElement);
  assert.equal(layer.querySelectorAll('[data-interview-analyzer]').length, 2);
  assert.equal(w.document.body.querySelector('[data-interview-analyzer]'), null);
});

test("other sites' jobs get card buttons but are never looked up", async () => {
  const asked = [];
  const link = (id) => `<li><a href="https://www.linkedin.com/jobs/view/${id}">Job ${id}</a></li>`;
  page(async (m) => (m.type === 'lookup' && asked.push(...m.jobUrls), { ok: true, matches: {} }), {
    url: 'https://attacker.example/page',
    body: `<ul>${link(1234567)}${link(7654321)}</ul>`,
  });
  await tick(600);
  assert.deepEqual(asked, []);
});

// ---------------------------------------------------------------------------
// What's on top of a card. jsdom has no layout, so cards get a size and elementsFromPoint answers
// with a set stack of elements (topmost first), the way a browser hit test would.

function stackedPage(stack) {
  return page(async () => ({ ok: false }), {
    setup: (w) => {
      w.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 200, left: 0, right: 800, width: 800, height: 100 });
      w.document.elementsFromPoint = () => stack(w);
    },
  });
}
const firstCard = (w) => w.document.querySelector('.srp-jobtuple-wrapper .row1');
const firstHost = (w) => w.document.querySelector('[data-interview-analyzer-layer] [data-interview-analyzer]');
const layerOf = (w) => w.document.querySelector('[data-interview-analyzer-layer]');

test('a card button shows when its card is on top, and hides under something else', async () => {
  let covering = null;
  const { w } = stackedPage((w) => [firstHost(w), covering ?? firstCard(w)].filter(Boolean));
  await tick(100);
  assert.equal(firstHost(w).style.display, '');
  assert.match(firstHost(w).style.transform, /^translate\(\d+px, \d+px\)$/);

  covering = w.document.createElement('div'); // a menu opened over the card
  w.document.body.append(covering);
  await tick(100);
  assert.equal(firstHost(w).style.display, 'none');
});

test('buttons drawn under their list raise the layer above the page, once', async () => {
  // At first the list is drawn over the layer (the button comes after the card in the stack).
  const { w } = stackedPage((w) => (layerOf(w).style.zIndex === '5' ? [firstCard(w), firstHost(w)] : [firstHost(w), firstCard(w)]));
  await tick(150);
  assert.equal(layerOf(w).style.zIndex, '2147483645');
  assert.equal(firstHost(w).style.display, '');
});

test("a button covered by its card's own menu shows again once the page changes", async () => {
  let menuOpen = false;
  const { w } = stackedPage((w) => {
    if (!menuOpen) return [firstHost(w), firstCard(w)];
    // The card's "⋯" menu, part of the card, drawn over the button.
    return [firstCard(w).querySelector('a') ?? firstCard(w), firstHost(w)];
  });
  await tick(100);
  assert.equal(firstHost(w).style.display, '');
  // Raise first, so "covered" here means the card's own content and not the whole list.
  w.document.querySelector('[data-interview-analyzer-layer]').style.zIndex = '2147483645';

  menuOpen = true;
  w.document.body.setAttribute('class', 'menu-open');
  await tick(300);
  assert.equal(firstHost(w).style.display, 'none');

  menuOpen = false;
  w.document.body.setAttribute('class', '');
  await tick(300);
  assert.equal(firstHost(w).style.display, '');
});
