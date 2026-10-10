// Reads job details off the page. Each supported site gets an adapter; every other site falls back to
// the schema.org JobPosting most job pages embed for search engines, then to the page title.
// Selectors match on stable class names or parts of them, since sites rename their hashed CSS classes.

(() => {
  if (globalThis.IASites) return;

  const clean = (s) => (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim();
  const text = (el) => clean(el?.textContent);

  /** The first element matching the selectors, tried in priority order (not document order). */
  const first = (root, ...selectors) => selectors.reduce((found, sel) => found ?? root.querySelector(sel), null);

  /** Job description HTML -> plain text, keeping paragraphs and list items on their own lines. */
  function htmlToText(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html'); // inert: scripts don't run
    doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    doc.querySelectorAll('p, div, li, h1, h2, h3, h4, tr').forEach((el) => el.append('\n'));
    doc.querySelectorAll('li').forEach((li) => li.prepend('• '));
    return (doc.body.textContent ?? '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const TRACKING_PARAMS = /^(utm_.*|src|sid|xp|px|ref|refid|trk|trackingid|currentjobid|from|position|pagenum)$/i;

  /** Absolute link without tracking parameters, so the same job always has the same link. '' if unusable. */
  function cleanUrl(href) {
    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return '';
    }
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    [...url.searchParams.keys()].forEach((key) => TRACKING_PARAMS.test(key) && url.searchParams.delete(key));
    if (url.href.length > 500) url.search = '';
    return url.href.length > 500 ? '' : url.href;
  }

  const usableSalary = (s) => (s && !/not disclosed|confidential/i.test(s) ? s.slice(0, 100) : '');

  function jsonLdJobPosting() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue;
      }
      const items = [data].flat().flatMap((d) => d?.['@graph'] ?? [d]);
      const job = items.find((d) => [].concat(d?.['@type']).includes('JobPosting'));
      if (job) return job;
    }
    return null;
  }

  function salaryFromJsonLd(base) {
    const value = base?.value;
    if (!value) return '';
    const amount = value.minValue && value.maxValue ? `${value.minValue}-${value.maxValue}` : value.value ?? value.minValue;
    if (!amount) return '';
    return [base.currency, amount, value.unitText && `per ${value.unitText.toLowerCase()}`].filter(Boolean).join(' ');
  }

  function fromJsonLd() {
    const job = jsonLdJobPosting();
    if (!job) return {};
    const org = job.hiringOrganization;
    return {
      role: clean(job.title),
      company: clean(typeof org === 'string' ? org : org?.name),
      description: htmlToText(job.description),
      salary: usableSalary(salaryFromJsonLd(job.baseSalary)),
      jobUrl: typeof job.url === 'string' ? job.url : '',
    };
  }

  // ---------------------------------------------------------------------------
  // Naukri. Class names checked against naukri.com's stylesheets in October 2026. The job page uses
  // CSS modules (styles_jd-header-title__rZwM1), so those are matched on the readable part only.

  const naukri = {
    source: 'job_board',
    matches: () => /(^|\.)naukri\.com$/.test(location.hostname),

    /** Job cards on search and recommendation lists. */
    findCards(root = document) {
      const cards = new Set(root.querySelectorAll('.srp-jobtuple-wrapper, .cust-job-tuple'));
      if (!cards.size) {
        // Unknown list layout: any block that links to a job page
        root.querySelectorAll('a[href*="/job-listings-"]').forEach((a) => {
          const card = a.closest('[data-job-id], article');
          if (card) cards.add(card);
        });
      }
      // A wrapper and the tuple inside it are the same card: keep the outer one.
      return [...cards].filter((card) => ![...cards].some((other) => other !== card && other.contains(card)));
    },

    fromCard(card) {
      const link = first(card, 'a.title', 'a[href*="/job-listings-"]');
      const company = first(card, 'a.comp-name', '.comp-name');
      return {
        role: link?.getAttribute('title') || text(link),
        company: company?.getAttribute('title') || text(company),
        salary: usableSalary(text(first(card, '.sal-wrap .sal span', '.sal-wrap'))),
        jobUrl: link?.href,
        description: '', // the list only shows a snippet; save from the job's own page to keep the full text
      };
    },

    /**
     * Puts the button on the card's bottom row, just left of Naukri's own "Save" (which is pinned to the
     * row's right edge, so the button keeps clear of it).
     */
    placeButton(card, host) {
      const save = first(card, '.save-job-tag', '.srp-save-icons');
      const row = save?.parentElement ?? first(card, '.row6') ?? card;
      // 64px is Naukri's "Save" with its icon, in case it isn't laid out yet.
      if (save) host.style.cssText = `margin-left: auto; margin-right: ${Math.max(save.offsetWidth, 64) + 16}px;`;
      row.append(host);
    },

    isJobPage: () => location.pathname.includes('/job-listings-'),

    fromPage() {
      // The company block also holds its AmbitionBox rating and review count: take only the name link.
      const company = first(document, '[class*="jd-header-comp-name"] > a', '[class*="jd-header-comp-name"] a');
      return {
        role: text(first(document, '[class*="jd-header-title"]', 'h1')),
        company: company?.getAttribute('title') || text(company),
        salary: usableSalary(text(first(document, '[class*="jhc__salary"] span', '[class*="jhc__salary"]'))),
        description: htmlToText(first(document, '[class*="JDC__dang-inner-html"]', '[class*="job-desc-container"]')?.innerHTML),
        jobUrl: location.href,
      };
    },
  };

  const adapters = [naukri];
  const adapter = adapters.find((a) => a.matches()) ?? null;

  /** Combines sources field by field: the first source with a value wins. */
  const merge = (...sources) =>
    sources.reduce((acc, src) => {
      Object.entries(src ?? {}).forEach(([k, v]) => {
        if (!acc[k] && v) acc[k] = v;
      });
      return acc;
    }, {});

  function finish(job) {
    return {
      role: (job.role ?? '').slice(0, 200),
      company: (job.company ?? '').slice(0, 200),
      salary: job.salary ?? '',
      description: job.description ?? '',
      jobUrl: cleanUrl(job.jobUrl || location.href),
      source: adapter?.source ?? 'job_board',
    };
  }

  globalThis.IASites = {
    adapter,

    fromCard: (card) => finish(adapter.fromCard(card)),

    /** The job on this page, from whatever the page offers. Selected text stands in for a missing description. */
    fromPage() {
      const selection = String(getSelection() ?? '').trim();
      const title = document.title.split(/\s[|\-–—]\s/)[0];
      return finish(
        merge(adapter?.isJobPage() ? adapter.fromPage() : {}, fromJsonLd(), {
          role: text(document.querySelector('h1')) || title,
          description: selection.length > 80 ? selection : '',
          jobUrl: location.href,
        }),
      );
    },
  };
})();
