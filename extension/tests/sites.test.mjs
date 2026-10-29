// Reading jobs off pages (content/sites.js), run in jsdom. Every site is read the same way; the markup
// follows real sites' structure (Naukri's class names were checked against naukri.com's stylesheets).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SITES = readFileSync(new URL('../src/content/sites.js', import.meta.url), 'utf8');

/** Results come from jsdom's own JavaScript realm; copy them to plain objects to compare. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** Loads a page and runs sites.js in it, the way Chrome runs it as a content script. */
function load(url, html) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.eval(SITES);
  return dom.window;
}

// A Naukri search result, with Naukri's class names.
const naukriCard = ({ id, title = 'Backend Engineer', company = 'Acme', salary = '12-18 Lacs PA' } = {}) => `
  <div class="srp-jobtuple-wrapper" data-job-id="${id}"><div class="cust-job-tuple layout-wrapper lay-2 sjw__tuple">
    <div class="row1"><h2><a class="title" title="${title}" href="https://www.naukri.com/job-listings-x-${id}?src=jobsearchDesk&sid=17&xp=1&px=1">${title}</a></h2></div>
    <div class="row2"><span class="comp-dtls-wrap"><a class="comp-name" title="${company}" href="#">${company}</a></span></div>
    <div class="row3"><span class="sal-wrap"><span class="sal"><span title="${salary}">${salary}</span></span></span></div>
    <div class="row6"><span class="job-post-day">1 Day Ago</span><span class="save-job-tag">Save</span></div>
  </div></div>`;

test('finds the job cards in a list (Naukri) and strips search tracking from their links', () => {
  const w = load(
    'https://www.naukri.com/backend-jobs',
    `<body>${naukriCard({ id: '091025000111' })}${naukriCard({ id: '091025000222', title: 'SRE', salary: 'Not disclosed' })}</body>`,
  );
  const cards = w.IASites.findCards();
  assert.equal(cards.length, 2);
  assert.ok(cards[0].classList.contains('srp-jobtuple-wrapper')); // the whole card, not just its title
  const [first, second] = plain(cards.map((c) => w.IASites.fromCard(c)));
  assert.deepEqual(first, {
    role: 'Backend Engineer',
    company: 'Acme',
    salary: '',
    description: '',
    jobUrl: 'https://www.naukri.com/job-listings-x-091025000111',
    source: 'job_board',
  });
  assert.equal(second.role, 'SRE');
  assert.equal(second.jobUrl, 'https://www.naukri.com/job-listings-x-091025000222');

});

test('finds cards that are wrapped in a link to the job (LinkedIn)', () => {
  const card = (id, title, company) => `<li><div class="base-card">
    <a class="base-card__full-link" href="https://in.linkedin.com/jobs/view/${title.toLowerCase()}-${id}?position=1&refId=x&trackingId=y"><span>${title}</span></a>
    <h3 class="base-search-card__title">${title}</h3>
    <h4 class="base-search-card__subtitle"><a href="https://in.linkedin.com/company/${company.toLowerCase()}">${company}</a></h4></div></li>`;
  const w = load('https://www.linkedin.com/jobs/search?keywords=backend', `<body><ul>${card('4471319619', 'Backend', 'Hitachi')}${card('4462829040', 'SDE', 'Amazon')}</ul></body>`);
  const cards = w.IASites.findCards();
  assert.equal(cards.length, 2);
  assert.deepEqual(
    plain(cards.map((c) => w.IASites.fromCard(c))).map((j) => [j.role, j.company, j.jobUrl]),
    [
      // refId and trackingId change on every visit and go; position might name a job on some site, so it stays.
      ['Backend', 'Hitachi', 'https://in.linkedin.com/jobs/view/backend-4471319619?position=1'],
      ['SDE', 'Amazon', 'https://in.linkedin.com/jobs/view/sde-4462829040?position=1'],
    ],
  );
});

test('no cards on a page linking to just one job, or for the job the page itself shows', () => {
  let w = load('https://blog.example.com/post', `<body><p>We're hiring: <a href="https://jobs.example.com/jobs/12345">Engineer</a></p></body>`);
  assert.equal(w.IASites.findCards().length, 0);
  w = load(
    'https://jobs.example.com/jobs/12345',
    `<body><h1>Engineer</h1><a href="/jobs/12345?utm_source=x">Apply</a><a href="/jobs/67890">Designer</a></body>`,
  );
  assert.equal(w.IASites.findCards().length, 0); // the page's own job doesn't count, so only one job is listed
});

test('reads a job page (Naukri), without the company rating or review count', () => {
  const w = load(
    'https://www.naukri.com/job-listings-backend-engineer-acme-bengaluru-3-to-5-years-091025012345?src=jobsearchDesk&sid=1&xp=2&px=1',
    `<body>
      <h1 class="styles_jd-header-title__rZwM1">Backend Engineer</h1>
      <div class="styles_jd-header-comp-name__MvqAI"><a title="Acme" href="#">Acme</a>
        <a class="styles_amb-rating__4UyFL">4.1</a><span class="styles_amb-reviews__0J1e3">2.3k Reviews</span></div>
      <div class="styles_jhc__salary__jdfEC"><i></i><span>12-18 Lacs PA</span></div>
      <section class="styles_job-desc-container__txpYf">
        <button class="styles_apply-button__uJI3A">Apply</button>
        <div class="styles_JDC__dang-inner-html__h0K4t"><p>Build APIs.</p><ul><li>Python</li><li>SQL</li></ul><p>${'We ship every day. '.repeat(20)}</p></div>
      </section>
    </body>`,
  );
  const job = plain(w.IASites.fromPage());
  assert.equal(job.role, 'Backend Engineer');
  assert.equal(job.company, 'Acme');
  assert.equal(job.salary, '12-18 Lacs PA');
  assert.match(job.description, /^Build APIs\.\n• Python\n• SQL\nWe ship every day\./);
  assert.equal(job.jobUrl, 'https://www.naukri.com/job-listings-backend-engineer-acme-bengaluru-3-to-5-years-091025012345');
  assert.equal(w.IASites.isJobPage(), true);
});

test('reads schema.org JobPosting and strips only tracking from links', () => {
  const w = load(
    'https://www.linkedin.com/jobs/search/?currentJobId=4242&keywords=data&utm_source=mail&ref=feed',
    `<head><title>Data Engineer | Example</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"x"},
        {"@type":"JobPosting","title":"Data Engineer","hiringOrganization":{"@type":"Organization","name":"Example Ltd"},
         "description":"<p>Build pipelines.</p><p>Use <b>Spark</b>.</p>",
         "baseSalary":{"currency":"USD","value":{"minValue":100000,"maxValue":140000,"unitText":"YEAR"}}}]}</script>
    </head><body><h1>Data Engineer</h1></body>`,
  );
  const job = w.IASites.fromPage();
  assert.equal(job.role, 'Data Engineer');
  assert.equal(job.company, 'Example Ltd');
  assert.equal(job.salary, 'USD 100000-140000 per year');
  assert.equal(job.description, 'Build pipelines.\nUse Spark.');
  // currentJobId is what tells LinkedIn jobs apart, so it stays (as do ref and the rest).
  assert.equal(job.jobUrl, 'https://www.linkedin.com/jobs/search/?currentJobId=4242&keywords=data&ref=feed');
});

test('a link too long to store is dropped rather than cut short', () => {
  const w = load(`https://jobs.example.com/view?id=1&q=${'x'.repeat(600)}`, '<body><h1>Engineer</h1></body>');
  assert.equal(w.IASites.fromPage().jobUrl, '');
});

// (Selected text standing in for the description isn't covered: jsdom can't read selections.)
test('falls back to the heading, then the page title, on pages with no job data', () => {
  let w = load('https://careers.example.com/jobs/7', '<head><title>Careers</title></head><body><h1>Platform Engineer</h1></body>');
  assert.equal(w.IASites.fromPage().role, 'Platform Engineer');
  assert.equal(w.IASites.fromPage().jobUrl, 'https://careers.example.com/jobs/7');

  w = load('https://careers.example.com/jobs/8', '<head><title>SRE - Example Careers</title></head><body></body>');
  assert.equal(w.IASites.fromPage().role, 'SRE');
});

// ---------------------------------------------------------------------------
// Any site, read the same way. Markup follows each site's structure (title format, class names).

const LONG = 'Design, build and run the services behind our product, with care for reliability. '.repeat(5);

test("a JobPosting for a job that isn't on screen any more is ignored", () => {
  // Single-page sites keep the first job's JobPosting after switching to another job.
  const w = load(
    'https://www.linkedin.com/jobs/search/?currentJobId=2',
    `<head><script type="application/ld+json">{"@type":"JobPosting","title":"Old Job","hiringOrganization":"Old Co"}</script></head>
     <body><h1>New Job</h1></body>`,
  );
  const job = w.IASites.fromPage();
  assert.equal(job.role, 'New Job');
  assert.notEqual(job.company, 'Old Co');
});

test('reads a job open beside a search list (LinkedIn-style), not the first card in the list', () => {
  const w = load(
    'https://www.linkedin.com/jobs/search/?currentJobId=4242&keywords=backend',
    `<head><title>(3) Backend Engineer | Acme Corp | LinkedIn</title></head><body>
      <ul class="jobs-search-results-list">
        <li><div class="job-card-list__title">Frontend Developer</div><div class="artdeco-entity-lockup__subtitle company-name">Wrong Co</div></li>
      </ul>
      <div class="jobs-search__job-details">
        <h1 class="t-24 job-details-jobs-unified-top-card__job-title">Backend Engineer</h1>
        <div class="job-details-jobs-unified-top-card__company-name"><a href="#">Acme Corp</a></div>
        <button class="jobs-apply-button">Easy Apply</button>
        <article class="jobs-description__container"><div id="job-details"><h2>About the job</h2><p>${LONG}</p>
          <ul><li>Go</li><li>Postgres</li></ul></div></article>
      </div></body>`,
  );
  const job = plain(w.IASites.fromPage());
  assert.equal(job.role, 'Backend Engineer');
  assert.equal(job.company, 'Acme Corp');
  assert.match(job.description, /^About the job\nDesign, build/);
  assert.match(job.description, /• Go\n• Postgres$/);
  assert.equal(job.jobUrl, 'https://www.linkedin.com/jobs/search/?currentJobId=4242&keywords=backend');
  assert.equal(w.IASites.isJobPage(), true);
});

test('reads a job page with no JobPosting (Indeed-style): company and salary from beside the job, not the title', () => {
  const w = load(
    'https://in.indeed.com/viewjob?jk=abc123',
    `<head><title>Data Analyst - Bengaluru, Karnataka - Indeed.com</title></head><body>
      <div class="jobsearch-ViewJobLayout">
        <h1 data-testid="jobsearch-JobInfoHeader-title">Data Analyst</h1>
        <div data-testid="inlineHeader-companyName"><a href="#">Beta Analytics</a></div>
        <div id="salaryInfoAndJobType"><span>₹6,00,000 - ₹9,00,000 a year</span></div>
        <button>Apply now</button>
        <div id="jobDescriptionText"><p>${LONG}</p></div>
      </div></body>`,
  );
  const job = w.IASites.fromPage();
  assert.equal(job.role, 'Data Analyst');
  assert.equal(job.company, 'Beta Analytics'); // not "Bengaluru, Karnataka" from the title
  assert.equal(job.salary, '₹6,00,000 - ₹9,00,000 a year');
  assert.match(job.description, /^Design, build/);
  assert.equal(w.IASites.isJobPage(), true);
});

test('a careers page with plain markup: description from its headings, company from the title', () => {
  const w = load(
    'https://careers.acme.dev/positions/42',
    `<head><title>Senior SRE - Acme Careers</title></head><body>
      <nav><a href="/">Home</a></nav>
      <main><h1>Senior SRE</h1>
        <section><h2>Responsibilities</h2><ul><li>Keep production healthy</li><li>Own on-call</li></ul></section>
        <section><h2>Requirements</h2><p>${LONG}</p></section>
        <a href="/apply">Apply now</a>
      </main>
      <footer>Subscribe to our newsletter</footer></body>`,
  );
  const job = w.IASites.fromPage();
  assert.equal(job.role, 'Senior SRE');
  assert.equal(job.company, 'Acme'); // "Careers" is the site's word, not the company's
  assert.match(job.description, /Responsibilities\n• Keep production healthy\n• Own on-call/);
  assert.match(job.description, /Requirements\nDesign, build/);
  assert.doesNotMatch(job.description, /newsletter|Home/);
  assert.equal(w.IASites.isJobPage(), true);
});

for (const [site, title, role, company] of [
  ['Glassdoor', 'Acme hiring Backend Engineer Job in Bengaluru, Karnataka | Glassdoor', 'Backend Engineer', 'Acme'],
  ['Wellfound', 'Software Engineer at Actioneer • Bengaluru | Wellfound', 'Software Engineer', 'Actioneer'],
  ['LinkedIn (signed out)', 'Python Backend Engineer at Hitachi Solutions — Pune, Maharashtra', 'Python Backend Engineer', 'Hitachi Solutions'],
  ['Greenhouse', 'Job Application for Platform Engineer at Stripe', 'Platform Engineer', 'Stripe'],
]) {
  test(`reads role and company from a ${site} page title`, () => {
    const w = load('https://jobs.example.com/job/1', `<head><title>${title}</title></head><body></body>`);
    const job = w.IASites.fromPage();
    assert.equal(job.role, role);
    assert.equal(job.company, company);
  });
}

test('a "Company - Role" title (Lever-style) gives the company next to the role heading', () => {
  const w = load(
    'https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c',
    `<head><title>Palantir Technologies - Forward Deployed Engineer</title></head>
     <body><div class="posting-headline"><h1>Forward Deployed Engineer</h1></div></body>`,
  );
  const job = w.IASites.fromPage();
  assert.equal(job.role, 'Forward Deployed Engineer');
  assert.equal(job.company, 'Palantir Technologies');
});

test('reads a JobPosting written as microdata', () => {
  const w = load(
    'https://example.org/vacancy/9',
    `<body><div itemscope itemtype="https://schema.org/JobPosting">
      <h1 itemprop="title">QA Engineer</h1>
      <div itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">Gamma</span></div>
      <div itemprop="description"><p>Test things.</p></div></div></body>`,
  );
  const job = w.IASites.fromPage();
  assert.deepEqual([job.role, job.company, job.description], ['QA Engineer', 'Gamma', 'Test things.']);
  assert.equal(w.IASites.isJobPage(), true);
});

test('pages that only look a bit like jobs get no button', () => {
  // A job-like address, but a list of results with no job open.
  let w = load('https://jobs.example.com/search?q=engineer', '<body><h1>42 engineer jobs</h1><ul><li>One</li></ul></body>');
  assert.equal(w.IASites.isJobPage(), false);
  // Zoom meeting links (/j/<number>) on a calendar or course page.
  w = load(
    'https://calendar.google.com/calendar/u/0/r',
    '<body><a href="https://us02web.zoom.us/j/81234567890?pwd=abc">Standup</a><a href="https://us02web.zoom.us/j/89876543210?pwd=def">Retro</a></body>',
  );
  assert.equal(w.IASites.findCards().length, 0);
  // A long article with a heading, but not at a job address.
  w = load('https://blog.example.com/posts/7', `<body><h1>My week</h1><h2>Requirements</h2><p>${LONG}</p></body>`);
  assert.equal(w.IASites.isJobPage(), false);
});

// ---------------------------------------------------------------------------
// Review findings, kept fixed.

test("another site's jobs: cards still, but marked as not this site's (never looked up), and never the page's own link", () => {
  // A company careers page often links to its jobs on Greenhouse or Lever.
  const w = load(
    'https://attacker.example/page',
    `<body><ul><li><a href="https://www.linkedin.com/jobs/view/1234567">A</a></li><li><a href="https://www.linkedin.com/jobs/view/7654321">B</a></li></ul>
     <script type="application/ld+json">{"@type":"JobPosting","title":"Bait","url":"https://www.linkedin.com/jobs/view/1234567"}</script>
     <h1>Bait</h1></body>`,
  );
  const cards = w.IASites.findCards();
  assert.equal(cards.length, 2);
  assert.equal(w.IASites.sameSite(w.IASites.fromCard(cards[0]).jobUrl), false);
  assert.equal(w.IASites.fromPage().jobUrl, 'https://attacker.example/page'); // not the other site's link
});

test('subdomains of shared hosts are sites of their own', () => {
  const w = load('https://evil.github.io/', '<body></body>');
  assert.equal(w.IASites.sameSite('https://victim.github.io/jobs/1234567'), false);
  assert.equal(w.IASites.sameSite('https://evil.github.io/jobs/1234567'), true);
  for (const [page, other] of [
    ['https://evil.wixsite.com/', 'https://victim.wixsite.com/jobs/1234567'],
    ['https://evil.s3.amazonaws.com/', 'https://victim.s3.amazonaws.com/jobs/1234567'],
    ['https://a.s3.us-east-1.amazonaws.com/', 'https://b.s3.us-east-1.amazonaws.com/jobs/1234567'],
  ]) {
    assert.equal(load(page, '<body></body>').IASites.sameSite(other), false, page);
  }
  const li = load('https://www.linkedin.com/jobs/search', '<body></body>');
  assert.equal(li.IASites.sameSite('https://in.linkedin.com/jobs/view/1234567'), true);
});

test('job boards with job-openings, job-<id> and /j/ addresses (Monster, Instahyre, Hirist) get cards', () => {
  for (const [url, a, b] of [
    ['https://www.foundit.in/srp', '/job-openings/java-developer-bengaluru-1234567', '/job-openings/sre-pune-7654321'],
    ['https://www.instahyre.com/search-jobs/', '/job-1234567-backend-engineer-at-acme-bangalore/', '/job-7654321-sre-at-beta-pune/'],
    ['https://www.hirist.tech/', '/j/backend-engineer-acme-3-to-5-yrs-1234567.html', '/j/sre-beta-2-to-4-yrs-7654321.html'],
  ]) {
    const w = load(url, `<body><ul><li><a href="${a}">One</a></li><li><a href="${b}">Two</a></li></ul></body>`);
    assert.equal(w.IASites.findCards().length, 2, url);
  }
});

test('a job you have already applied to is still a job page', () => {
  for (const label of ['Applied', 'Applied 3 days ago', 'Application submitted', 'Withdraw application']) {
    const w = load(
      'https://careers.example.com/jobs/42',
      `<body><h1>Platform Engineer</h1><div class="job-description"><h2>Responsibilities</h2><p>${LONG}</p></div><button>${label}</button></body>`,
    );
    assert.equal(w.IASites.isJobPage(), true, label);
  }
});

test('finding cards stays fast on long lists', () => {
  const cards = Array.from({ length: 1500 }, (_, i) => {
    const href = `https://jobs.example.com/jobs/${100000 + i}`;
    return `<li><a href="${href}">Job ${i}</a><a href="${href}"><img alt=""></a><span>Company ${i}</span></li>`;
  }).join('');
  const w = load('https://jobs.example.com/search', `<body><ul>${cards}</ul></body>`);
  const started = performance.now();
  assert.equal(w.IASites.findCards().length, 1500);
  assert.ok(performance.now() - started < 2000, 'took too long');
});

test('news and blog pages about jobs get no buttons', () => {
  const w = load(
    'https://news.example.com/business',
    `<body><a href="/business/jobs-report-october-1234567.html">Jobs report</a><a href="/tech/careers-in-ai-7654321.html">Careers in AI</a>
     <a href="/news/jobs/1234567">Hiring slows</a><a href="/blog/careers/7654321">Our culture</a></body>`,
  );
  assert.equal(w.IASites.findCards().length, 0);

  const article = load(
    'https://news.example.com/business/jobs-report-october-1234567.html',
    `<body><h1>Jobs report</h1><div class="article-description"><h2>Requirements</h2><p>${LONG}</p></div></body>`,
  );
  assert.equal(article.IASites.isJobPage(), false);
});

test('a JobPosting in the body still has to be on screen, not just in its own script', () => {
  const w = load(
    'https://www.linkedin.com/jobs/search/?currentJobId=2',
    `<body><script type="application/ld+json">{"@type":"JobPosting","title":"Old Stale Role"}</script><h1>New Job</h1></body>`,
  );
  assert.equal(w.IASites.fromPage().role, 'New Job');
});
