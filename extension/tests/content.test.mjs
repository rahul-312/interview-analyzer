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
// What's on top of a card. jsdom has no layout, so each card gets a box of its own (stacked down the
// page) and elementsFromPoint answers with a stack of elements (topmost first) chosen by the test for
// the card at that point, the way a browser hit test would.

const CARD_HEIGHT = 150;

/** stackFor(w, { index, card, host, raised }) returns the elements at a point over card number index. */
function stackedPage(stackFor) {
  return page(async () => ({ ok: false }), {
    setup: (w) => {
      w.HTMLElement.prototype.getBoundingClientRect = function () {
        const cards = [...w.document.querySelectorAll('.srp-jobtuple-wrapper')];
        const index = cards.indexOf(this);
        const width = Number(this.dataset.width ?? 800);
        const top = index === -1 ? 100 : 100 + index * CARD_HEIGHT;
        return { top, bottom: top + 100, left: 0, right: width, width, height: 100 };
      };
      w.document.elementsFromPoint = (x, y) => {
        const cards = [...w.document.querySelectorAll('.srp-jobtuple-wrapper')];
        const index = Math.floor((y - 100) / CARD_HEIGHT);
        const hosts = [...w.document.querySelectorAll('[data-interview-analyzer-layer] [data-interview-analyzer]')];
        const layer = w.document.querySelector('[data-interview-analyzer-layer]');
        return stackFor(w, { index, card: cards[index], host: hosts[index], raised: layer?.style.zIndex !== '5' });
      };
    },
  });
}
const hostAt = (w, i) => w.document.querySelectorAll('[data-interview-analyzer-layer] [data-interview-analyzer]')[i];
const layerOf = (w) => w.document.querySelector('[data-interview-analyzer-layer]');
const inner = (card) => card.querySelector('.row1');

test('a card button shows when its card is on top, and hides under something else', async () => {
  let covering = null;
  const { w } = stackedPage((w, { card, host }) => [host, covering ?? inner(card)]);
  await tick(100);
  assert.equal(hostAt(w, 0).style.display, '');
  assert.match(hostAt(w, 0).style.transform, /^translate\(\d+px, \d+px\)$/);

  covering = w.document.createElement('div'); // a site pop-up, outside the cards
  w.document.body.append(covering);
  await tick(100);
  assert.equal(hostAt(w, 0).style.display, 'none');
});

test('a list drawn over the layer raises it above the page; one covered card does not', async () => {
  // Only the first card has something over its button (a tooltip): no raise.
  let wholeList = false;
  const { w } = stackedPage((w, { index, card, host, raised }) =>
    !raised && (wholeList || index === 0) ? [inner(card), host] : [host, inner(card)],
  );
  await tick(150);
  assert.equal(layerOf(w).style.zIndex, '5');
  assert.equal(hostAt(w, 1).style.display, '');

  // The whole list is drawn over the layer: raised, and the buttons show.
  wholeList = true;
  w.document.body.setAttribute('class', 'x'); // the next check
  await tick(400);
  assert.equal(layerOf(w).style.zIndex, '2147483645');
  assert.equal(hostAt(w, 0).style.display, '');
  assert.equal(hostAt(w, 1).style.display, '');
});

test("after a raise, a button keeps off its card's own menu, and comes back when it closes", async () => {
  let menu = null;
  const { w } = stackedPage((w, { index, card, host, raised }) => {
    if (!raised) return [inner(card), host]; // the list is above the layer: raise first
    // Raised, the button is drawn over everything, including the card's open "⋯" menu.
    return index === 0 && menu ? [host, menu] : [host, inner(card)];
  });
  await tick(150);
  assert.equal(layerOf(w).style.zIndex, '2147483645');
  assert.equal(hostAt(w, 0).style.display, '');

  menu = w.document.createElement('ul'); // narrow, and positioned on its own
  menu.dataset.width = '160';
  menu.style.position = 'absolute';
  w.document.querySelector('.srp-jobtuple-wrapper').append(menu);
  await tick(300);
  assert.equal(hostAt(w, 0).style.display, 'none');

  menu.remove();
  menu = null;
  w.document.body.setAttribute('class', 'closed');
  await tick(300);
  assert.equal(hostAt(w, 0).style.display, '');
});

test('the raise is undone on a new page of a site that changes page without reloading', async () => {
  let newPage = false;
  const { w } = stackedPage((w, { card, host, raised }) => (!raised && !newPage ? [inner(card), host] : [host, inner(card)]));
  await tick(150);
  assert.equal(layerOf(w).style.zIndex, '2147483645');

  newPage = true;
  w.history.pushState({}, '', '/other-jobs');
  w.document.body.append(w.document.createElement('div')); // the new page's content
  await tick(200);
  assert.equal(layerOf(w).style.zIndex, '5');
});
