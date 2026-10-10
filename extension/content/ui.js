// The "Add application" pop-up and the buttons, drawn inside shadow roots so the job site's CSS
// can't reach them (and theirs can't leak out). Page text only ever goes in via textContent/value.

(() => {
  if (globalThis.IAUi) return;

  const STATUS_OPTIONS = [
    ['saved', 'Saved'],
    ['applied', 'Applied'],
    ['screening', 'Screening'],
    ['interview', 'Interviewing'],
    ['offer', 'Offer'],
    ['rejected', 'Rejected'],
    ['withdrawn', 'Withdrawn'],
  ];

  // Same palette as the app (frontend/src/styles/globals.css).
  const TOKENS = `
    --primary: #4F46E5; --primary-dark: #4338CA; --primary-light: #EEF2FF; --primary-border: #C7D2FE;
    --ink: #0F172A; --charcoal: #334155; --medium-gray: #64748B; --light-silver: #94A3B8;
    --light-gray: #E2E8F0; --input-border: #CBD5E1; --smoke: #F1F5F9; --page-bg: #F8FAFC;
    --green: #059669; --green-light: #ECFDF5; --red: #DC2626; --red-light: #FEF2F2;
    font-family: 'Outfit', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  `;

  const DIALOG_CSS = `
    :host { all: initial; ${TOKENS} }
    * { box-sizing: border-box; font-family: inherit; }
    .overlay { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
      padding: 16px; background: rgba(15, 23, 42, 0.4); }
    .modal { width: 100%; max-width: 512px; max-height: calc(100vh - 32px); overflow-y: auto; border-radius: 16px;
      background: #fff; box-shadow: 0 20px 40px rgba(15, 23, 42, 0.2); color: var(--ink); font-size: 14px; line-height: 1.4; }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px;
      border-bottom: 1px solid var(--light-gray); }
    .head h2 { margin: 0; font-size: 18px; font-weight: 600; }
    .x { border: 0; background: none; color: var(--light-silver); cursor: pointer; font-size: 22px; line-height: 1; padding: 4px; }
    .x:hover { color: var(--charcoal); }
    .body { padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } }
    label.field { display: flex; flex-direction: column; gap: 6px; font-weight: 500; color: var(--charcoal); }
    input, select { width: 100%; height: 44px; padding: 0 14px; border: 1px solid var(--input-border); border-radius: 10px;
      background: #fff; color: var(--ink); font-size: 14px; outline: none; }
    input:focus, select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light); }
    .check { display: flex; align-items: center; gap: 8px; color: var(--charcoal); cursor: pointer; }
    .check input { width: 16px; height: 16px; accent-color: var(--primary); }
    .muted { color: var(--medium-gray); font-size: 13px; }
    .link-row { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    a { color: var(--primary); text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
    .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
    .btn { height: 44px; padding: 0 18px; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; }
    .btn:hover { text-decoration: none; }
    .primary { border: 0; background: var(--primary); color: #fff; }
    .primary:hover { background: var(--primary-dark); }
    .secondary { border: 1px solid var(--input-border); background: #fff; color: var(--charcoal); }
    .secondary:hover { background: var(--page-bg); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { padding: 10px 12px; border-radius: 10px; background: var(--red-light); color: var(--red); }
    .done { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0 4px; text-align: center; }
    .tick { display: flex; width: 48px; height: 48px; align-items: center; justify-content: center; border-radius: 999px;
      background: var(--green-light); color: var(--green); font-size: 24px; }
    .done strong { font-size: 16px; }
  `;

  const BUTTON_CSS = `
    :host { all: initial; display: inline-block; vertical-align: middle; ${TOKENS} }
    button { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 12px; border-radius: 999px;
      border: 1px solid var(--primary-border); background: var(--primary-light); color: var(--primary-dark);
      font-family: inherit; font-size: 13px; font-weight: 500; line-height: 1; cursor: pointer; white-space: nowrap; }
    button:hover { background: var(--primary); border-color: var(--primary); color: #fff; }
    button.saved { border-color: #A7F3D0; background: var(--green-light); color: var(--green); }
    button.saved:hover { background: var(--green-light); color: var(--green); }
    :host(.floating) { position: fixed; right: 24px; bottom: 24px; z-index: 2147483646; }
    :host(.floating) button { height: 44px; padding: 0 18px; font-size: 14px; border: 0; background: var(--primary);
      color: #fff; box-shadow: 0 8px 24px rgba(79, 70, 229, 0.35); }
    :host(.floating) button:hover { background: var(--primary-dark); }
    :host(.floating) button.saved { background: var(--green); color: #fff; }
  `;

  /** Tiny element builder: h('div', { class: 'x', onclick }, 'text', child). Strings become text nodes. */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'value') el.value = value;
      else if (key === 'checked') el.checked = value;
      else el.setAttribute(key, value === true ? '' : value);
    });
    el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
    return el;
  }

  /** Messages the background worker. Never throws: failures come back as { ok: false, error }. */
  async function ask(type, data = {}) {
    try {
      return (await chrome.runtime.sendMessage({ type, ...data })) ?? { ok: false, error: 'No reply from the extension.' };
    } catch {
      return { ok: false, error: 'The extension was updated. Reload this page and try again.' };
    }
  }

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // ---------------------------------------------------------------------------
  // Save dialog

  let openDialog = null; // { host, close }

  /** Opens the pop-up for one job, as read by IASites. `onSaved(app)` runs once it's saved. */
  function openSaveDialog(job, { onSaved } = {}) {
    openDialog?.close();

    const host = h('div', { 'data-interview-analyzer': '' });
    const root = host.attachShadow({ mode: 'closed' });
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add application' });
    const overlay = h('div', { class: 'overlay' }, modal);
    root.append(h('style', {}, DIALOG_CSS), overlay);
    document.documentElement.append(host);

    let appUrl = '';
    const close = () => {
      host.remove();
      document.removeEventListener('keydown', onKey, true);
      if (openDialog?.host === host) openDialog = null;
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => e.target === overlay && close());
    openDialog = { host, close };

    /** Swaps the dialog's content. */
    const show = (title, ...body) => {
      modal.replaceChildren(
        h('div', { class: 'head' }, h('h2', {}, title), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, '×')),
        h('div', { class: 'body' }, ...body),
      );
      modal.querySelector('input, select, .primary')?.focus();
    };
    const errorBox = () => h('div', { class: 'error', hidden: true });
    const showError = (box, message) => {
      box.textContent = message;
      box.hidden = !message;
    };

    function showSignIn(next) {
      const error = errorBox();
      const username = h('input', { name: 'username', autocomplete: 'username', required: true });
      const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
      const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
      show(
        'Sign in to Interview Analyzer',
        h('p', { class: 'muted', style: 'margin:0' }, 'Sign in once and you can save jobs from here. You stay signed in for a week.'),
        h(
          'form',
          {
            style: 'display:flex;flex-direction:column;gap:16px',
            onsubmit: async (e) => {
              e.preventDefault();
              submit.disabled = true;
              showError(error, '');
              const res = await ask('login', { username: username.value.trim(), password: password.value });
              submit.disabled = false;
              if (res.ok) next();
              else showError(error, res.error);
            },
          },
          error,
          h('label', { class: 'field' }, 'Username', username),
          h('label', { class: 'field' }, 'Password', password),
          h('div', { class: 'actions' }, h('button', { class: 'btn secondary', type: 'button', onclick: close }, 'Cancel'), submit),
        ),
      );
    }

    function showAlreadySaved(app) {
      show(
        'Already saved',
        h('p', { style: 'margin:0' }, `You saved ${app.role} at ${app.company} on ${app.date_applied}.`),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn secondary', onclick: () => showForm() }, 'Add it again'),
          h('a', { class: 'btn primary', href: `${appUrl}/applications/${app.id}`, target: '_blank', rel: 'noopener' }, 'Open it'),
        ),
      );
    }

    function showSaved(app) {
      show(
        'Add application',
        h(
          'div',
          { class: 'done' },
          h('span', { class: 'tick' }, '✓'),
          h('strong', {}, 'Saved to Interview Analyzer'),
          h('span', { class: 'muted' }, `${app.role} at ${app.company}`),
        ),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn secondary', onclick: close }, 'Done'),
          h('a', { class: 'btn primary', href: `${appUrl}/applications/${app.id}`, target: '_blank', rel: 'noopener' }, 'Open it'),
        ),
      );
    }

    // Keeps what was typed if the user has to sign in again halfway.
    const draft = {
      company: job.company,
      role: job.role,
      date_applied: today(),
      status: 'applied',
      salary: job.salary,
      withDescription: Boolean(job.description),
    };

    function showForm() {
      const error = errorBox();
      const input = (name, attrs = {}) =>
        h('input', { name, value: draft[name] ?? '', required: true, oninput: (e) => (draft[name] = e.target.value), ...attrs });
      // A job saved for later has a "date saved", not a "date applied", as in the app.
      const dateLabel = h('span', {});
      const syncDateLabel = () => (dateLabel.textContent = draft.status === 'saved' ? 'Date saved' : 'Date applied');
      syncDateLabel();
      const status = h(
        'select',
        {
          name: 'status',
          onchange: (e) => {
            draft.status = e.target.value;
            syncDateLabel();
          },
        },
        STATUS_OPTIONS.map(([value, label]) => h('option', { value, selected: value === draft.status }, label)),
      );
      const words = job.description ? job.description.split(/\s+/).length : 0;
      const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Add application');

      show(
        'Add application',
        h(
          'form',
          {
            style: 'display:flex;flex-direction:column;gap:16px',
            onsubmit: async (e) => {
              e.preventDefault();
              submit.disabled = true;
              showError(error, '');
              const res = await ask('save', {
                application: {
                  company: draft.company.trim(),
                  role: draft.role.trim(),
                  date_applied: draft.date_applied,
                  status: draft.status,
                  salary: (draft.salary ?? '').trim(),
                  job_url: job.jobUrl,
                  source: job.source,
                  job_description: draft.withDescription ? job.description : '',
                },
              });
              submit.disabled = false;
              if (res.ok) {
                chrome.storage.local.set({ lastStatus: draft.status }).catch(() => {});
                onSaved?.(res.app);
                showSaved(res.app);
              } else if (res.signedOut) showSignIn(showForm);
              else showError(error, res.error);
            },
          },
          error,
          h(
            'div',
            { class: 'grid' },
            h('label', { class: 'field' }, 'Company', input('company', { maxlength: 200 })),
            h('label', { class: 'field' }, 'Role', input('role', { maxlength: 200 })),
            h('label', { class: 'field' }, dateLabel, input('date_applied', { type: 'date' })),
            h('label', { class: 'field' }, 'Status', status),
          ),
          h('label', { class: 'field' }, 'Salary (optional)', input('salary', { required: false, maxlength: 100 })),
          words > 0 &&
            h(
              'label',
              { class: 'check' },
              h('input', { type: 'checkbox', checked: draft.withDescription, onchange: (e) => (draft.withDescription = e.target.checked) }),
              `Save the job description (${words} words), used later for prep plans`,
            ),
          job.jobUrl && h('div', { class: 'muted link-row' }, 'Link: ', h('a', { href: job.jobUrl, target: '_blank', rel: 'noopener' }, job.jobUrl)),
          h('div', { class: 'actions' }, h('button', { class: 'btn secondary', type: 'button', onclick: close }, 'Cancel'), submit),
        ),
      );
    }

    show('Add application', h('p', { class: 'muted', style: 'margin:0' }, 'Loading…'));

    (async () => {
      const status = await ask('status');
      appUrl = status.appUrl ?? '';
      // Start from the status picked last time: some people save jobs to apply later, others after applying.
      const { lastStatus } = await chrome.storage.local.get({ lastStatus: 'applied' }).catch(() => ({}));
      if (STATUS_OPTIONS.some(([value]) => value === lastStatus)) draft.status = lastStatus;
      const start = async () => {
        if (job.jobUrl) {
          const found = await ask('find', { jobUrl: job.jobUrl });
          if (found.signedOut) return showSignIn(start);
          if (found.ok && found.app) return showAlreadySaved(found.app);
          // Any other failure (server down…) shows up when saving, with the form already filled.
        }
        showForm();
      };
      if (!status.ok || !status.user) showSignIn(start);
      else start();
    })();
  }

  // ---------------------------------------------------------------------------
  // Buttons

  /** A "+ Save" pill. Clicks don't reach the page (job cards open the job when clicked). */
  function trackButton({ floating = false, onClick }) {
    const host = h('span', { 'data-interview-analyzer': '', class: floating ? 'floating' : undefined });
    const root = host.attachShadow({ mode: 'closed' });
    const button = h('button', { type: 'button', title: 'Save to Interview Analyzer' });
    const stop = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach((type) => button.addEventListener(type, (e) => e.stopPropagation()));
    button.addEventListener('click', (e) => {
      stop(e);
      onClick();
    });
    root.append(h('style', {}, BUTTON_CSS), button);

    const setSaved = (saved) => {
      button.classList.toggle('saved', saved);
      button.textContent = saved ? '✓ Saved' : floating ? '+ Save to Interview Analyzer' : '+ Track';
    };
    setSaved(false);
    return { host, setSaved };
  }

  globalThis.IAUi = { openSaveDialog, trackButton, ask };
})();
