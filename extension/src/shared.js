// Shared by the background worker and the extension's own pages (never loaded into job sites).

/** Where the Django API and the Next.js app run. Changeable from the popup's settings. */
export const DEFAULT_SETTINGS = {
  apiUrl: 'http://localhost:8000/api',
  appUrl: 'http://localhost:3000',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Why a server address can't be used, or '' if it's fine. Only https, except on this computer:
 * passwords and tokens must not cross the network unencrypted.
 */
export function serverUrlProblem(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return `"${value}" isn't a full address, like https://example.com.`;
  }
  if (url.protocol === 'https:') return '';
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return '';
  return `Use an https:// address for ${url.host || value} (http:// is only allowed for localhost).`;
}

/** Sends a message to the background worker. Resolves to { ok, ...data } or { ok: false, error }, never throws. */
export async function ask(type, data = {}) {
  try {
    return (await chrome.runtime.sendMessage({ type, ...data })) ?? { ok: false, error: 'No reply from the extension.' };
  } catch (err) {
    return { ok: false, error: `The extension isn't responding (${err.message}). Try reloading it.` };
  }
}

/** Turns a DRF error body like {"role": ["This field is required."]} into one readable line. */
export function errorText(err) {
  if (typeof err === 'string') return err;
  if (Array.isArray(err)) return err.map(errorText).join(' ');
  if (err && typeof err === 'object') {
    return Object.entries(err)
      .map(([key, value]) => {
        const text = errorText(value);
        if (key === 'detail' || key === 'non_field_errors') return text;
        return `${key.replace(/_/g, ' ')}: ${text}`;
      })
      .join(' ');
  }
  return '';
}
