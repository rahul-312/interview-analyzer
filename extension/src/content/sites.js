// Reads job details off the page, the same way on every site: the schema.org JobPosting most job pages
// embed for search engines, then what's on screen (the job's heading, elements named like a company or
// salary, the block under "Responsibilities"…), then the page title. Job lists are found the same way:
// each link to a single job, in the card around it. No site has code of its own.
// Selectors match on parts of class names, since sites rename their hashed CSS classes.

(() => {
  if (globalThis.IASites) return;

  const clean = (s) => (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim();
  const text = (el) => clean(el?.textContent);

  /** Job description HTML -> plain text, keeping paragraphs and list items on their own lines. */
  function htmlToText(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html'); // inert: scripts don't run
    doc.querySelectorAll('script, style, noscript, template, svg, button').forEach((el) => el.remove());
    doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    doc.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, header').forEach((el) => el.append('\n'));
    doc.querySelectorAll('li').forEach((li) => li.prepend('• '));
    return (doc.body.textContent ?? '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Search and ad tracking that job sites add to links, and that never says which job it is
  // (Naukri's src/sid/xp/px, LinkedIn's refId/trackingId/pageNum, which change on every visit, and ad
  // click ids). Names like ref, from, position or currentJobId identify the job on some sites, so they stay.
  const TRACKING = new Set(['src', 'sid', 'xp', 'px', 'refid', 'trackingid', 'pagenum', 'gclid', 'fbclid', 'msclkid']);

  /** The site a host belongs to: in.linkedin.com and www.linkedin.com are both linkedin.com, www.naukri.co.in is naukri.co.in. */
  function siteOf(hostname) {
    const labels = hostname.toLowerCase().split('.');
    const twoPart = labels.length >= 3 && labels.at(-1).length === 2 && /^(co|com|org|net|ac|gov|edu)$/.test(labels.at(-2));
    return labels.slice(twoPart ? -3 : -2).join('.');
  }

  /**
   * Whether a link is on the site this page is on. Only those are read or looked up: any page can
   * link to any job, and a page linking to other sites' jobs could otherwise learn which ones are saved.
   */
  const sameSite = (url) => {
    try {
      return siteOf(new URL(url, location.href).hostname) === siteOf(location.hostname);
    } catch {
      return false;
    }
  };

  /**
   * Absolute link without tracking parameters, so the same job always has the same link. '' if unusable.
   * Too long a link is dropped, not cut, so two jobs never share one.
   */
  function cleanUrl(href) {
    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return '';
    }
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    [...url.searchParams.keys()].forEach((key) => {
      if (/^utm_/i.test(key) || TRACKING.has(key.toLowerCase())) url.searchParams.delete(key);
    });
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

  /** The page's text, without scripts and styles (a JobPosting's own script would otherwise always "show" its title). */
  function pageText() {
    if (!document.body) return '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('script, style, noscript, template') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const parts = [];
    while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
    return clean(parts.join(' ')).toLowerCase();
  }

  /** Some sites (LinkedIn) escape the description's HTML a second time: "&lt;p&gt;" instead of "<p>". */
  const unescapeHtml = (s) =>
    typeof s === 'string' && /&lt;[a-z]/i.test(s) ? new DOMParser().parseFromString(s, 'text/html').body.textContent : s;

  /**
   * Single-page sites keep the JobPosting of the first job they loaded while showing another one,
   * so it's only trusted when its title is on the page.
   */
  function fromJsonLd() {
    const job = jsonLdJobPosting();
    if (!job || !clean(job.title) || !pageText().includes(clean(job.title).toLowerCase())) return {};
    const org = job.hiringOrganization;
    return {
      role: clean(job.title),
      company: clean(typeof org === 'string' ? org : org?.name),
      description: htmlToText(unescapeHtml(job.description)),
      salary: usableSalary(salaryFromJsonLd(job.baseSalary)),
      jobUrl: typeof job.url === 'string' && sameSite(job.url) ? job.url : '',
    };
  }

  /** The same JobPosting written as microdata (itemprop attributes) instead of JSON-LD. */
  function fromMicrodata() {
    const job = document.querySelector('[itemscope][itemtype*="schema.org/JobPosting" i]');
    if (!job) return {};
    const prop = (name) => job.querySelector(`[itemprop="${name}"]`);
    const org = prop('hiringOrganization');
    return {
      role: text(prop('title')),
      company: text(org?.querySelector('[itemprop="name"]') ?? org),
      description: htmlToText(prop('description')?.innerHTML),
      salary: usableSalary(text(prop('baseSalary'))),
    };
  }

  // ---------------------------------------------------------------------------
  // Any site: what's on screen. Single-page job sites (LinkedIn, Indeed, Workday…) switch jobs without
  // reloading and often carry no JobPosting at all, so the page itself is read the same way everywhere.

  // A job word as a whole part of an address: a host name label (jobs.lever.co, careers.acme.com) or a
  // path segment (/jobs/, /careers/…), or /job-listings-… and /viewjob. Never inside a slug, so news
  // like /business/jobs-report-october-1234567.html doesn't count.
  const JOB_WORD = String.raw`(?:^|\.)(?:jobs?|careers?)\.|\/(?:jobs?|careers?|positions?|openings?|vacanc(?:y|ies)|postings?|requisitions?|opportunit(?:y|ies))(?:\/|$)|\/(?:job-listings?|viewjob)\b`;
  const JOB_ID_PARAM = /^(jk|vjk|gh_jid|currentjobid|jobid|job_id)$/i;
  // Sections of a site that write about jobs rather than offer them.
  const NOT_JOBS = /\/(news|blogs?|articles?|story|stories|opinion|press|insights|guides?|advice)(\/|$)/i;

  /** Whether an address could be a job page: a job word in it, or a job id in its query, and not in a news or blog section. */
  function jobAddress({ hostname, pathname, searchParams }) {
    if (NOT_JOBS.test(pathname)) return false;
    return new RegExp(JOB_WORD, 'i').test(hostname + pathname) || [...searchParams.keys()].some((key) => JOB_ID_PARAM.test(key));
  }

  // Headings that start the description on almost every job page.
  const DESCRIPTION_HEADING =
    /^(job description|description|about (the|this) (role|job|position|opportunity)|the role|role overview|(key )?responsibilities|what you('ll| will) do|requirements|qualifications|who you are|what we('re| are) looking for)\b/i;

  // Parts of a page title that name the site or the page rather than the job.
  const NOT_A_COMPANY = /^(linkedin|indeed(\.com)?|glassdoor|naukri(\.com)?|foundit|monster|instahyre|hirist|cutshort|wellfound|iimjobs|shine(\.com)?|apna|internshala|workday|lever|greenhouse|ashby|smartrecruiters|jobs?|careers?|job details?|job application|apply|home)$/i;

  const SEPARATOR = /\s+[|•·–—-]\s+/;

  /** "Stripe Careers" -> "Stripe": what's left once the site's own words are gone. */
  const companyName = (s) => clean(s).replace(/\s+(careers?|jobs?)$/i, '');

  const hidden = (el) =>
    Boolean(el.closest('[hidden], [aria-hidden="true"], template')) ||
    (typeof el.checkVisibility === 'function' && !el.checkVisibility());

  /** Short visible text (as `read` gives it) of the first element matching the selector inside root and `accept`, or ''. */
  function shortText(root, selector, max = 150, accept = () => true, read = text) {
    for (const el of root.querySelectorAll(selector)) {
      const value = read(el);
      if (value && value.length <= max && accept(value, el) && !hidden(el)) return value;
    }
    return '';
  }

  // Where a job's title is: the page heading, or a header's title (LinkedIn's top card, Indeed's job pane…).
  const ROLE =
    'h1, h2, [class*="job-title" i], [class*="jobtitle" i], [class*="job_title" i], [data-testid*="jobtitle" i], ' +
    '[data-testid*="job-title" i], [class*="header-title" i], [data-testid*="header-title" i], [class*="top-card" i][class*="title" i]';
  const COMPANY =
    '[class*="company-name" i], [class*="companyname" i], [class*="company_name" i], [class*="comp-name" i], ' +
    '[data-testid*="companyname" i], [data-testid*="company-name" i], [class*="employer-name" i], ' +
    '[class*="employername" i], [class*="org-name" i], ' +
    // a link to the company's page on the site (LinkedIn /company/, Indeed /cmp/…)
    'a[href*="/company/" i], a[href*="/companies/" i], a[href*="/cmp/" i]';
  // Link texts that name something about the company rather than the company ("Salaries for Acme", "4.1").
  const NOT_A_NAME = /\b(salar(y|ies)|reviews?|ratings?|jobs|followers?|see all|view|about)\b|^[\d.,k+★ ]+$/i;
  const SALARY = '[class*="salary" i], [id*="salary" i], [data-testid*="salary" i], [class*="compensation" i], [class*="pay-range" i]';
  const DESCRIPTION =
    '[class*="description" i], [id*="description" i], [data-testid*="description" i], [class*="job-desc" i], ' +
    '[class*="job-details" i], [id*="job-details" i], [class*="jobdetails" i], [class*="posting-page" i]';

  /**
   * A company element's name. Its title says it best; a block holding the name link next to a rating
   * and review count ("Acme 4.1 2.3k Reviews") gives the name link's.
   */
  function companyText(el) {
    const named = (node) => clean(node?.getAttribute('title')) || text(node);
    const link = [...el.querySelectorAll('a')].find((a) => named(a) && !NOT_A_NAME.test(named(a)));
    return clean(el.getAttribute('title')) || named(link) || text(el);
  }

  /** The deepest common ancestor of the elements. */
  function commonAncestor(elements) {
    return elements.reduce((acc, el) => {
      let node = acc;
      while (node && !node.contains(el)) node = node.parentElement;
      return node;
    });
  }

  /**
   * The block holding the job description: an element named like one, or else the section under
   * headings like "Responsibilities" and "Requirements". Of nested matches, the innermost that still
   * holds most of the text, so the company blurb and buttons around it stay out.
   */
  function descriptionBlock() {
    const named = [...document.querySelectorAll(DESCRIPTION)].filter(
      (el) => el.tagName !== 'META' && el.textContent.length >= 200 && !hidden(el),
    );
    if (named.length) {
      let best = named.reduce((a, b) => (b.textContent.length > a.textContent.length ? b : a));
      for (;;) {
        const inner = named.find((el) => el !== best && best.contains(el) && el.textContent.length >= best.textContent.length * 0.7);
        if (!inner) return best;
        best = inner;
      }
    }

    const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, b, [role="heading"]')].filter(
      (el) => DESCRIPTION_HEADING.test(text(el)) && text(el).length <= 60 && !hidden(el),
    );
    if (!headings.length) return null;
    let block = headings.length > 1 ? commonAncestor(headings) : headings[0];
    while (block && block.textContent.length < 300) block = block.parentElement;
    return block && block !== document.body && block !== document.documentElement ? block : null;
  }

  /**
   * Role and company from the page title, which most job sites set to one of
   * "Role at Company", "Company hiring Role in City", or parts like "Role | Company | Site".
   * Parts alone can't say which is the role, so they're only used next to a role read elsewhere.
   */
  function fromTitle(knownRole) {
    const title = clean(document.title).replace(/^\(\d+\+?\)\s*/, ''); // "(3) …": unread notifications
    const head = title.split(/\s+[|•·—]\s+/)[0];
    let m = head.match(/^(?:job application for\s+)?(.+?)\s+at\s+(.+)$/i);
    if (m) return { role: m[1], company: companyName(m[2]) };
    m = head.match(/^(.+?)\s+(?:is\s+)?hiring\s+(?:for\s+)?(.+?)(?:\s+jobs?)?(?:\s+in\s+.+)?$/i);
    if (m) return { role: m[2], company: companyName(m[1]) };

    const parts = title.split(SEPARATOR).map(clean).filter((p) => p && !NOT_A_COMPANY.test(p));
    const role = knownRole?.toLowerCase();
    const at = parts.findIndex((p) => p.toLowerCase() === role);
    if (at === -1) return {};
    // Next to the role: after it ("Role | Company | Site") or, on company sites, before it ("Company - Role").
    // It might be a city instead ("Role - City - Indeed.com"), so it's only a guess.
    return { guess: companyName(parts[at + 1] ?? parts[at - 1] ?? '') };
  }

  const depth = (el) => {
    let n = 0;
    for (let node = el; node; node = node.parentElement) n += 1;
    return n;
  };

  /**
   * The job's title element: of the headings and title-like elements, the one closest to the
   * description (on a search page with a job open beside the list, the page's own h1 is "Jobs in…"),
   * else the first h1. Headings inside the description ("Responsibilities") don't count.
   */
  function roleHeading(description) {
    const candidates = [...document.querySelectorAll(ROLE)].filter((el) => {
      const value = text(el);
      // Subheadings inside the description don't count, but a block found from its headings may hold the h1.
      const inDescription = description?.contains(el) && el.tagName !== 'H1';
      return value && value.length <= 150 && !DESCRIPTION_HEADING.test(value) && !inDescription && !hidden(el);
    });
    if (!description) return candidates.find((el) => el.tagName === 'H1') ?? candidates[0] ?? null;
    let best = null;
    let bestDepth = -1;
    for (const el of candidates) {
      const d = depth(commonAncestor([el, description]));
      if (d > bestDepth || (d === bestDepth && el.tagName === 'H1' && best.tagName !== 'H1')) [best, bestDepth] = [el, d];
    }
    return best;
  }

  /**
   * Whether el belongs to another job's title than heading's (a list entry, "similar jobs"…): the
   * nearest block around it that has a title in it doesn't hold this job's heading.
   */
  function underOtherTitle(el, heading) {
    if (!heading) return false;
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (node.querySelector(`h1, h2, h3, h4, ${ROLE}`)) return !node.contains(heading);
    }
    return false;
  }

  function fromScreen() {
    const description = descriptionBlock();
    const headingEl = roleHeading(description);
    const heading = text(headingEl);
    const titled = fromTitle(heading);
    const siteName = clean(document.querySelector('meta[property="og:site_name"]')?.content);
    // Only this job's company and salary: on a search page the first ones belong to the list's first
    // card. So look beside the job (around its title and description) first, and skip other jobs' cards.
    const root = description && headingEl ? commonAncestor([description, headingEl]) : null;
    const ours = (value, el) => !underOtherTitle(el, headingEl);
    const company = (value, el) => !NOT_A_NAME.test(value) && ours(value, el);
    const salary = (value, el) => /\d/.test(value) && ours(value, el);
    return {
      role: titled.role || heading,
      company:
        titled.company ||
        (root && shortText(root, COMPANY, 100, company, companyText)) ||
        titled.guess ||
        shortText(document, COMPANY, 100, company, companyText) ||
        (NOT_A_COMPANY.test(siteName) ? '' : siteName),
      salary: usableSalary(shortText(root ?? document, SALARY, 100, salary)),
      description: description ? htmlToText(description.innerHTML).slice(0, 20000) : '',
    };
  }

  // A button or link to apply, which every job page has and articles about jobs don't.
  const APPLY = /^(easy\s+)?apply\b|\bapply\s+(now|for (this|the) (job|role|position)|on (the )?company)/i;

  /**
   * A page showing one job: it carries a visible JobPosting, or it has a job address, a role, a
   * description and an apply button.
   */
  function looksLikeJobPage() {
    if (fromJsonLd().role || fromMicrodata().role) return true;
    if (!jobAddress(new URL(location.href))) return false;
    const block = descriptionBlock();
    if (!block || block.textContent.length < 300 || !roleHeading(block)) return false;
    return [...document.querySelectorAll('a, button, [role="button"], input[type="submit"]')].some(
      (el) => APPLY.test(text(el) || el.value || '') && !hidden(el),
    );
  }

  // ---------------------------------------------------------------------------
  // Job lists, on any site: each link to a single job, in the card around it.

  // A link to one job: a job address with an id after the job word (/job-listings-…-091025012345,
  // /jobs/view/…-4471319619, jobs.lever.co/acme/<uuid>, /job/Pune/Engineer_JR1234567), or a job id
  // in its query (?jk=, ?gh_jid=…).
  const JOB_PATH = new RegExp(`(?:${JOB_WORD})[^?#]*?(?:\\d{5,}|[0-9a-f]{8}-[0-9a-f]{4})`, 'i');

  /**
   * The job a link points to: its cleaned address, and a key that's the same for every link to that
   * job (a job id in the query names the job wherever the link goes: /viewjob?jk=1, /redirect?jk=1).
   * Null if it isn't a link to one job.
   */
  function jobOf(href) {
    const url = cleanUrl(href ?? '');
    if (!url) return null;
    const address = new URL(url);
    const { hostname, pathname, searchParams } = address;
    if (!jobAddress(address)) return null;
    const param = [...searchParams.keys()].find((key) => JOB_ID_PARAM.test(key) && searchParams.get(key));
    if (param) return { url, key: `${hostname} ${param.toLowerCase()}=${searchParams.get(param)}` };
    return JOB_PATH.test(hostname + pathname) ? { url, key: url } : null;
  }

  /** Links to jobs on this page's own site inside root. */
  const jobLinks = (root) =>
    [...(root.matches?.('a[href]') ? [root] : []), ...root.querySelectorAll('a[href]')]
      .map((link) => ({ link, job: jobOf(link.getAttribute('href')) }))
      .filter(({ job }) => job && sameSite(job.url));

  const MANY = Symbol('several jobs');

  /**
   * Job cards: for each job linked on the page, the largest block around its link that links to no
   * other job. Only on pages listing at least two jobs, and never for the job this page shows.
   *
   * One walk up the page from each link records which job each block holds, or that it holds
   * several. A walk stops at a block already known to hold its job or several, since everything
   * above that is known too, so the whole page is looked at about once.
   */
  function findCards() {
    const here = jobOf(location.href)?.key;
    const links = jobLinks(document).filter(({ link, job }) => job.key !== here && !hidden(link));
    if (new Set(links.map((l) => l.job.key)).size < 2) return [];

    const holds = new Map(); // block -> the one job key it links to, or MANY
    for (const { link, job } of links) {
      for (let node = link; node && node !== document.body; node = node.parentElement) {
        const was = holds.get(node);
        if (was === job.key || was === MANY) break;
        holds.set(node, was === undefined ? job.key : MANY);
      }
    }

    const cards = new Set();
    for (const { link, job } of links) {
      let card = link;
      while (card.parentElement && card.parentElement !== document.body && holds.get(card.parentElement) === job.key) {
        card = card.parentElement;
      }
      cards.add(card);
    }
    return [...cards].filter((card) => card.textContent.length <= 3000);
  }

  // Link and heading texts that are actions, not a job's title.
  const ACTION = /^(apply|easy apply|view|save|see|share|more|details|show)\b/i;

  /**
   * A company name above a card, for lists grouped by company (one company header, then its jobs):
   * the nearest one that isn't inside another job's card.
   */
  function groupCompany(card, link) {
    // The nearest block around el that links to a job: el's own card, or the group around several.
    const belongsHere = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (jobLinks(node).length) return node.contains(link);
      }
      return false;
    };
    for (let up = card.parentElement, level = 0; up && up !== document.body && level < 6; up = up.parentElement, level += 1) {
      const accept = (value, el) => !NOT_A_NAME.test(value) && !card.contains(el) && belongsHere(el);
      const found = shortText(up, COMPANY, 100, accept, companyText);
      if (found) return found;
    }
    return '';
  }

  /**
   * The company a whole page belongs to, from its title: a company's own job board is titled
   * "Jobs at Stripe" or just "Palantir Technologies". A job board's title ("12,000 Software Engineer
   * Jobs in Bengaluru | Indeed") has none.
   */
  function pageCompany() {
    const parts = clean(document.title).split(SEPARATOR);
    const m = parts[0].match(/^(?:jobs|careers|open (?:positions|roles)|current openings|work) at (.+)$/i);
    if (m) return companyName(m[1]);
    const name = parts.length === 1 ? parts[0] : '';
    const looksLikeName = name.split(' ').length <= 4 && !/\d|\b(jobs?|careers?|vacanc|hiring|search|results?|openings?)\b/i.test(name);
    return looksLikeName && !NOT_A_COMPANY.test(name) ? name : '';
  }

  /** The job on a card in a list. The list only shows a snippet, so the description is left for the job's own page. */
  function fromCard(card) {
    const links = jobLinks(card);
    const main = links.find(({ link }) => text(link) && !ACTION.test(text(link))) ?? links[0];
    // Its title: the link's title attribute, else the link's first line (links often hold the location
    // or date on lines of their own), else a heading in the card (for links with no text, like a logo).
    const firstLine = clean(htmlToText(main?.link.innerHTML).split('\n')[0]);
    const role =
      clean(main?.link.getAttribute('title')) ||
      (firstLine.length <= 150 && !ACTION.test(firstLine) ? firstLine : '') ||
      shortText(card, `h1, h2, h3, h4, h5, ${ROLE}`, 150, (value) => !ACTION.test(value));
    const notRole = (value) => !NOT_A_NAME.test(value) && value !== role;
    return {
      role,
      company:
        shortText(card, COMPANY, 100, notRole, companyText) || (main ? groupCompany(card, main.link) : '') || pageCompany(),
      salary: usableSalary(shortText(card, SALARY, 100, (value) => /\d/.test(value))),
      jobUrl: main?.job.url ?? '',
      description: '',
    };
  }

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
      // No fallback to the page's address here: on a list, every card would get the same one.
      jobUrl: job.jobUrl ? cleanUrl(job.jobUrl) : '',
      source: 'job_board',
    };
  }

  globalThis.IASites = {
    findCards,
    fromCard: (card) => finish(fromCard(card)),

    /** Whether this page shows one job, so it gets the floating "Save" button. */
    isJobPage: looksLikeJobPage,

    /**
     * The job on this page: JobPosting data, then what's on screen, then the page title.
     * Selected text replaces the description.
     */
    fromPage() {
      const selection = String(getSelection() ?? '').trim();
      return finish(
        merge(
          { description: selection.length > 80 ? selection : '' },
          fromJsonLd(),
          fromMicrodata(),
          fromScreen(),
          { role: document.title.split(SEPARATOR)[0], jobUrl: location.href },
        ),
      );
    },
  };
})();
