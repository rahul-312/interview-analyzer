// Puts "+ Track" on each job card in a list and "+ Save to Interview Analyzer" on a job's own page,
// on any site, and opens the save pop-up for the toolbar button. Runs on every https page, and is
// injected into other pages when the toolbar button is clicked; it only sets itself up once.

(() => {
  // Only ordinary web pages: https XML and SVG documents have no body to watch or put buttons on.
  if (globalThis.IAContent || !document.body) return;
  globalThis.IAContent = true;

  const { findCards, fromCard, fromPage, isJobPage, sameSite } = globalThis.IASites;
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

  // Only jobs on this page's own site are looked up (a page linking to other sites' jobs could otherwise
  // learn which ones are saved), and at most this many from one page, so no page can make the browser
  // flood the server. Jobs not looked up can still be saved; they just don't show "✓ Saved" until then.
  const MAX_LOOKUPS = 500;
  const asked = new Set();

  const queueLookup = (urls) => {
    urls.forEach((url) => {
      if (!url || !sameSite(url) || (!asked.has(url) && asked.size >= MAX_LOOKUPS)) return;
      asked.add(url);
      pending.add(url);
    });
    if (pending.size) lookupTimer ??= setTimeout(lookUp, 400);
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

  // "+ Track" buttons sit in a layer of their own over the page, each one over the right edge of its
  // card, and are never put inside the site's lists: the site's own code (React and the like) manages
  // those, and an element it didn't create can break the layout or the list's next re-render.
  // A button only shows where its card is what's on top, so the site's sticky headers, pop-ups and
  // scroll areas still hide it, whatever their z-index.
  const BUTTON = { width: 96, height: 28, inset: 12 };
  let layer = null;
  const placed = new Map(); // card -> { host, near }
  // Only cards on or near the screen are measured when the page scrolls.
  const nearScreen =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          entries.forEach((e) => {
            const p = placed.get(e.target);
            if (p) p.near = e.isIntersecting;
          });
          reposition();
        }, { rootMargin: '100px' })
      : null;

  /** Whether the card is what's on top at this point of the screen (not covered by a header or pop-up). */
  function onTop(card, x, y) {
    if (typeof document.elementsFromPoint !== 'function') return true;
    const hit = document.elementsFromPoint(x, y).find((el) => !layer.contains(el));
    return Boolean(hit && card.contains(hit));
  }

  let positioning = false;
  function reposition() {
    if (positioning || !placed.size) return;
    positioning = true;
    requestAnimationFrame(() => {
      positioning = false;
      // Measure every card first, then move every button: measuring after moving one would make the
      // browser lay the page out again for each button.
      const moves = [];
      placed.forEach((p, card) => {
        if (!card.isConnected) {
          moves.push({ p, card, gone: true });
          return;
        }
        if (!p.near) {
          moves.push({ p, at: null });
          return;
        }
        const box = card.getBoundingClientRect();
        // Centred on the part of the card that's on screen, so a card taller than the screen still gets one.
        const top = Math.max(box.top, 0);
        const bottom = Math.min(box.bottom, innerHeight);
        const middle = (top + bottom) / 2;
        const x = box.right - BUTTON.width - BUTTON.inset;
        const fits = bottom - top >= BUTTON.height && x >= box.left;
        moves.push({ p, at: fits && onTop(card, x + BUTTON.width / 2, middle) ? { x, y: middle - BUTTON.height / 2 } : null });
      });
      moves.forEach(({ p, card, gone, at }) => {
        if (gone) {
          p.host.remove();
          nearScreen?.unobserve(card);
          placed.delete(card);
          return;
        }
        p.host.style.display = at ? '' : 'none';
        if (at) p.host.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
      });
    });
  }
  addEventListener('scroll', reposition, { capture: true, passive: true }); // any scroll area, not just the page
  addEventListener('resize', reposition, { passive: true });

  /** "+ Track" for each job card, once. */
  function decorateCards() {
    findCards().forEach((card) => {
      if (placed.has(card)) return;
      if (!layer) {
        layer = document.createElement('div');
        layer.setAttribute('data-interview-analyzer-layer', '');
        layer.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 2147483645; overflow: hidden;';
        document.documentElement.append(layer);
      }
      const button = trackButton({ onClick: () => open(fromCard(card)) });
      button.host.style.cssText = 'position: absolute; top: 0; left: 0; pointer-events: auto;';
      layer.append(button.host);
      placed.set(card, { host: button.host, near: !nearScreen });
      nearScreen?.observe(card);
      register(fromCard(card).jobUrl, button);
    });
    reposition();
  }

  let floating = null; // { host, url }

  /** One floating button on a job's own page. Many job sites change page without reloading, so this re-checks. */
  function syncFloatingButton() {
    const url = location.href;
    const onJob = isJobPage();
    if (floating && (floating.url !== url || !onJob)) {
      floating.host.remove();
      floating = null;
    }
    if (floating || !onJob) return;

    const button = trackButton({ floating: true, onClick: () => open(fromPage()) });
    document.documentElement.append(button.host);
    floating = { host: button.host, url };
    register(fromPage().jobUrl, button);
  }

  // Job lists load as you scroll and filter, and job sites change page without reloading, so the page
  // is looked at again when it changes: at most once a second (this runs on every site, and many pages
  // change all the time), straight away when the address changes, and once more after the last change.
  let scanned = { url: null, at: -Infinity };
  let queued = false;
  let later = null;

  function scan() {
    scanned = { url: location.href, at: performance.now() };
    decorateCards();
    syncFloatingButton();
  }

  function update() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const wait = 1000 - (performance.now() - scanned.at);
      if (scanned.url !== location.href || wait <= 0) scan();
      else
        later ??= setTimeout(() => {
          later = null;
          scan();
        }, wait);
    });
  }
  // Card buttons follow their cards when the page's layout changes without scrolling.
  new MutationObserver(() => {
    update();
    reposition();
  }).observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  update();
})();
