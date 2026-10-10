// Shared by the background worker and the toolbar popup.

/** Where the Django API and the Next.js app run. Changeable from the popup's settings. */
export const DEFAULT_SETTINGS = {
  apiUrl: 'http://localhost:8000/api',
  appUrl: 'http://localhost:3000',
};

export const getSettings = () => chrome.storage.local.get(DEFAULT_SETTINGS);

/** Sends a message to the background worker. Resolves to its reply: { ok, ...data } or { ok: false, error }. */
export const ask = (type, data = {}) => chrome.runtime.sendMessage({ type, ...data });

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
