// Puts "+ Track" on each job card and "+ Save to Interview Analyzer" on job pages of supported
// sites, and opens the save pop-up for the toolbar button on any site. Runs on Naukri by default
// and is injected into other pages when the toolbar button is clicked; it only sets itself up once.

(() => {
  if (globalThis.IAContent) return;
  globalThis.IAContent = true;

  const { adapter, fromCard, fromPage } = globalThis.IASites;
  const { openSaveDialog, trackButton, ask } = globalThis.IAUi;

  // "✓ Saved" marks come from the app: the job links on screen are checked against it in batches, and
  // again whenever this tab comes back into view, so jobs added or deleted in the app (or on another
  // device) show correctly. Nothing is remembered between page loads.
  const known = new Map(); // jobUrl -> application id, or null when not saved
  const savedAt = new Map(); // jobUrl -> when it was saved from this page (newer than any lookup in flight)
  let buttons = []; // { jobUrl, host, setSaved }
  const pending = new Set();
  let lookupTimer = null;

  const refreshButtons = () => {
    buttons = buttons.filter((b) => b.host.isConnected); // cards replaced by paging or filters
    buttons.forEach((b) => b.setSaved(Boolean(known.get(b.jobUrl))));
  };

  async function lookUp() {
    lookupTimer = null;
    const urls = [...pending];
    pending.clear();
    if (!urls.length) return;
    const started = performance.now();
    const res = await ask('lookup', { jobUrls: urls });
    if (!res.ok) return; // signed out or offline: leave the buttons as they are
    urls.forEach((url) => {
      if ((savedAt.get(url) ?? -1) > started) return; // saved while this was in flight: that's newer
      known.set(url, res.matches[url] ?? null);
    });
    refreshButtons();
  }

  const queueLookup = (urls) => {
    urls.forEach((url) => url && pending.add(url));
    lookupTimer ??= setTimeout(lookUp, 400);
  };

  const register = (jobUrl, { host, setSaved }) => {
    if (!jobUrl) return; // no link: it can still be saved, but can't be matched
    buttons.push({ jobUrl, host, setSaved });
    setSaved(Boolean(known.get(jobUrl)));
    if (!known.has(jobUrl)) queueLookup([jobUrl]);
  };

  const markSaved = (app) => {
    if (!app.job_url) return;
    known.set(app.job_url, app.id);
    savedAt.set(app.job_url, performance.now());
    refreshButtons();
  };

  const open = (job) => openSaveDialog(job, { onSaved: markSaved });

  const recheckAll = () => {
    buttons = buttons.filter((b) => b.host.isConnected);
    queueLookup(buttons.map((b) => b.jobUrl));
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && recheckAll());

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'open-page') open(fromPage()); // the toolbar button: save the job this page shows
    if (message?.type === 'signed-in') recheckAll();
  });

  if (!adapter) return; // not a supported site: only the toolbar button works here

  const MARK = 'iaTracked';

  function decorateCards() {
    adapter.findCards().forEach((card) => {
      if (card.dataset[MARK]) return;
      card.dataset[MARK] = '1';
      const button = trackButton({ onClick: () => open(fromCard(card)) });
      adapter.placeButton(card, button.host);
      register(fromCard(card).jobUrl, button);
    });
  }

  let floating = null; // { host, url }

  /** One floating button on a job's own page. Naukri changes page without reloading, so this re-checks. */
  function syncFloatingButton() {
    const url = location.href;
    if (floating && (floating.url !== url || !adapter.isJobPage())) {
      floating.host.remove();
      floating = null;
    }
    if (floating || !adapter.isJobPage()) return;

    const button = trackButton({ floating: true, onClick: () => open(fromPage()) });
    document.documentElement.append(button.host);
    floating = { host: button.host, url };
    register(fromPage().jobUrl, button);
  }

  // Job lists load as you scroll and filter, so watch for new cards (batched to once per frame).
  let queued = false;
  const update = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      decorateCards();
      syncFloatingButton();
    });
  };
  new MutationObserver(update).observe(document.body, { childList: true, subtree: true });
  update();
})();
