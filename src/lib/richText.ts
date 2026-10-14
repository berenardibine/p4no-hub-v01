// Safe rich-text helpers for seller product descriptions.
// Descriptions may be legacy plain text or HTML produced by the product editor.

const ALLOWED = new Set([
  'P', 'BR', 'H1', 'H2', 'H3', 'H4', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'A', 'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'COLGROUP', 'COL', 'SPAN', 'CODE', 'PRE', 'MARK',
]);

export function isHtml(s: string | null | undefined): boolean {
  return !!s && /<(p|h[1-6]|ul|ol|li|table|strong|em|u|br|a|blockquote)\b[^>]*>/i.test(s);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convert legacy plain text into editor-friendly HTML paragraphs. */
export function plainToHtml(s: string): string {
  if (!s) return '';
  if (isHtml(s)) return s;
  return s.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/** Strip tags → plain text (for word counts, meta descriptions). */
export function htmlToText(s: string | null | undefined): string {
  if (!s) return '';
  if (!isHtml(s)) return s;
  return s
    .replace(/<\/(p|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Allow-list sanitizer (browser only). Drops scripts, event handlers, styles and unsafe links. */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined' || !html) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement;
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!ALLOWED.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'].includes(child.tagName)) { child.remove(); continue; }
        walk(child);
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const n = attr.name.toLowerCase();
        const keep =
          (child.tagName === 'A' && n === 'href' && /^(https?:|mailto:|tel:|\/)/i.test(attr.value.trim())) ||
          ((child.tagName === 'TD' || child.tagName === 'TH') && (n === 'colspan' || n === 'rowspan')) ||
          (n === 'style' && /^text-align:\s*(left|center|right);?$/i.test(attr.value.trim()));
        if (!keep) child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer nofollow'); }
      if (child.tagName === 'TABLE') {
        const wrap = doc.createElement('div'); wrap.className = 'table-scroll';
        child.replaceWith(wrap); wrap.appendChild(child);
      }
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}
