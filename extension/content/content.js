// Puts "+ Track" on each job card and "+ Save to Interview Analyzer" on job pages of supported
// sites, and opens the save pop-up for the toolbar button on any site. Runs on Naukri by default
// and is injected into other pages when the toolbar button is clicked; it only sets itself up once.

(() => {
  if (globalThis.IAContent) return;
  globalThis.IAContent = true;

  const { adapter, fromCard, fromPage } = globalThis.IASites;
  const { openSaveDialog, trackButton } = globalThis.IAUi;

  // Job links already saved (kept by the background worker), so buttons can say "Saved".
  let saved = {};
  let buttons = []; // { jobUrl, host, setSaved }
  const register = (jobUrl, { host, setSaved }) => {
    if (!jobUrl) return;
    buttons.push({ jobUrl, host, setSaved });
    setSaved(Boolean(saved[jobUrl]));
  };
  const refreshButtons = () => {
    buttons = buttons.filter((b) => b.host.isConnected); // cards replaced by paging or filters
    buttons.forEach((b) => b.setSaved(Boolean(saved[b.jobUrl])));
  };

  chrome.storage.local.get({ saved: {} }).then((data) => {
    saved = data.saved;
    refreshButtons();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.saved) return;
    saved = changes.saved.newValue ?? {};
    refreshButtons();
  });

  // The toolbar button: save whatever job this page shows.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'open-page') openSaveDialog(fromPage());
  });

  if (!adapter) return; // not a supported site: only the toolbar button works here

  const MARK = 'iaTracked';

  function decorateCards() {
    adapter.findCards().forEach((card) => {
      if (card.dataset[MARK]) return;
      card.dataset[MARK] = '1';
      const button = trackButton({ onClick: () => openSaveDialog(fromCard(card)) });
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

    const button = trackButton({ floating: true, onClick: () => openSaveDialog(fromPage()) });
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
