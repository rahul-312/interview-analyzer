// Reading jobs off pages (content/sites.js), run in jsdom against markup that follows Naukri's real
// class names (checked against naukri.com's stylesheets) and a generic schema.org job page.

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

const card = ({ id, title = 'Backend Engineer', company = 'Acme', salary = '12-18 Lacs PA', link = true } = {}) => `
  <div class="srp-jobtuple-wrapper" data-job-id="${id}"><div class="cust-job-tuple layout-wrapper lay-2 sjw__tuple">
    <div class="row1"><h2>${
      link ? `<a class="title" title="${title}" href="https://www.naukri.com/job-listings-x-${id}?src=jobsearchDesk&sid=17&xp=1&px=1">${title}</a>` : title
    }</h2></div>
    <div class="row2"><span class="comp-dtls-wrap"><a class="comp-name" title="${company}" href="#">${company}</a></span></div>
    <div class="row3"><span class="sal-wrap"><span class="sal"><span title="${salary}">${salary}</span></span></span></div>
    <div class="row6"><span class="job-post-day">1 Day Ago</span><span class="save-job-tag">Save</span></div>
  </div></div>`;

test('reads Naukri job cards and strips Naukri search tracking from links', () => {
  const w = load('https://www.naukri.com/backend-jobs', `<body>${card({ id: '111' })}${card({ id: '222', salary: 'Not disclosed' })}</body>`);
  const cards = w.IASites.adapter.findCards();
  assert.equal(cards.length, 2); // the wrapper and the tuple inside it are one card
  const [first, second] = plain(cards.map((c) => w.IASites.fromCard(c)));
  assert.deepEqual(first, {
    role: 'Backend Engineer',
    company: 'Acme',
    salary: '12-18 Lacs PA',
    description: '',
    jobUrl: 'https://www.naukri.com/job-listings-x-111',
    source: 'job_board',
  });
  assert.equal(second.salary, ''); // "Not disclosed" isn't a salary
  assert.equal(second.jobUrl, 'https://www.naukri.com/job-listings-x-222');
});

test("a card without a job link gets no link, not the search page's address", () => {
  const w = load('https://www.naukri.com/backend-jobs', `<body>${card({ id: '1', link: false })}${card({ id: '2', link: false })}</body>`);
  const jobs = plain(w.IASites.adapter.findCards().map((c) => w.IASites.fromCard(c)));
  assert.deepEqual(jobs.map((j) => j.jobUrl), ['', '']);
});

test('places the button on the bottom row, clear of Naukri\'s own "Save"', () => {
  const w = load('https://www.naukri.com/backend-jobs', `<body>${card({ id: '1' })}</body>`);
  const host = w.document.createElement('span');
  w.IASites.adapter.placeButton(w.IASites.adapter.findCards()[0], host);
  assert.ok(host.parentElement.classList.contains('row6'));
  assert.match(host.style.marginRight, /^\d+px$/);
  assert.ok(parseInt(host.style.marginRight, 10) >= 80);
});

test('reads a Naukri job page, without the company rating or the "about company" text', () => {
  const w = load(
    'https://www.naukri.com/job-listings-backend-engineer-acme-bengaluru-3-to-5-years-091025012345?src=jobsearchDesk&sid=1&xp=2&px=1',
    `<body>
      <h1 class="styles_jd-header-title__rZwM1">Backend Engineer</h1>
      <div class="styles_jd-header-comp-name__MvqAI"><a title="Acme" href="#">Acme</a>
        <a class="styles_amb-rating__4UyFL">4.1</a><span class="styles_amb-reviews__0J1e3">2.3k Reviews</span></div>
      <div class="styles_jhc__salary__jdfEC"><i></i><span>12-18 Lacs PA</span></div>
      <section class="styles_job-desc-container__txpYf">
        <div class="styles_JDC__dang-inner-html__h0K4t"><p>Build APIs.</p><ul><li>Python</li><li>SQL</li></ul></div>
        <div class="styles_dang-inner-html__8s6fv">About Acme: we make anvils.</div>
      </section>
    </body>`,
  );
  assert.deepEqual(plain(w.IASites.fromPage()), {
    role: 'Backend Engineer',
    company: 'Acme',
    salary: '12-18 Lacs PA',
    description: 'Build APIs.\n• Python\n• SQL',
    jobUrl: 'https://www.naukri.com/job-listings-backend-engineer-acme-bengaluru-3-to-5-years-091025012345',
    source: 'job_board',
  });
});

test('other sites: reads schema.org JobPosting and only strips utm_* from links', () => {
  const w = load(
    'https://www.linkedin.com/jobs/search/?currentJobId=4242&keywords=data&utm_source=mail&ref=feed',
    `<head><title>Data Engineer | Example</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"x"},
        {"@type":"JobPosting","title":"Data Engineer","hiringOrganization":{"@type":"Organization","name":"Example Ltd"},
         "description":"<p>Build pipelines.</p><p>Use <b>Spark</b>.</p>",
         "baseSalary":{"currency":"USD","value":{"minValue":100000,"maxValue":140000,"unitText":"YEAR"}}}]}</script>
    </head><body><h1>Jobs</h1></body>`,
  );
  assert.equal(w.IASites.adapter, null);
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
