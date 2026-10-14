// Single product-search entry point for the search popup and the /search page.
// Static-first: filters the pre-built CDN search index in memory (zero
// PostgREST egress per keystroke). Only if the index itself is unavailable do
// we fall back to ONE sanctioned database read per distinct submitted query.
import { getContent } from '@/lib/cdnGuard';
import { supabase } from '@/integrations/supabase/client';
import { allowLastResortRead } from '@/lib/apiFirewall';

export interface SearchHit {
  id: string;
  slug: string | null;
  title: string;
  price: number;
  images: string[];
  category: string | null;
  score: number;
}

interface IndexRow {
  kind?: string; id: string; slug?: string | null; title?: string;
  category?: string | null; price?: number; thumb?: string | null; desc?: string | null;
}

export const normalizeQuery = (q: string) =>
  q.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const norm = (s: unknown) => (typeof s === 'string' ? normalizeQuery(s.replace(/-/g, ' ')) : '');

let indexPromise: Promise<IndexRow[] | null> | null = null;
const loadIndex = () => {
  if (!indexPromise) {
    indexPromise = getContent<IndexRow[]>('search/search-index').then((d) => {
      const rows = Array.isArray(d) ? d.filter((r) => r?.kind === 'product') : null;
      if (!rows || rows.length === 0) indexPromise = null; // retry next time
      return rows && rows.length ? rows : null;
    }).catch(() => { indexPromise = null; return null; });
  }
  return indexPromise;
};

function scoreRow(tokens: string[], title: string, cat: string, desc: string): number {
  let score = 0;
  for (const t of tokens) {
    const inTitle = title.includes(t), inCat = cat.includes(t), inDesc = desc.includes(t);
    if (!inTitle && !inCat && !inDesc) return 0; // every word must match somewhere
    score += (inTitle ? 10 : 0) + (inCat ? 4 : 0) + (inDesc ? 1 : 0);
  }
  return score;
}

const fallbackCache = new Map<string, SearchHit[]>();

async function fallbackSearch(needle: string, tokens: string[]): Promise<SearchHit[]> {
  const cached = fallbackCache.get(needle);
  if (cached) return cached;
  allowLastResortRead('products');
  const term = `%${needle.replace(/[%,()]/g, ' ')}%`;
  const { data } = await supabase
    .from('products')
    .select('id, slug, title, price, images, category, description')
    .eq('status', 'active')
    .or(`title.ilike.${term},description.ilike.${term},category.ilike.${term}`)
    .limit(60);
  const hits = (data || []).map((p: any) => ({
    id: p.id, slug: p.slug ?? null, title: p.title, price: Number(p.price) || 0,
    images: Array.isArray(p.images) ? p.images : [], category: p.category ?? null,
    score: scoreRow(tokens, norm(p.title), norm(p.category), norm(p.description)) || 1,
  })).sort((a, b) => b.score - a.score);
  fallbackCache.set(needle, hits);
  return hits;
}

/**
 * @param allowFallback only true for a submitted query (Enter / search page),
 *   never for keystrokes — keeps any DB fallback to one read per query.
 */
export async function searchProducts(query: string, allowFallback = false): Promise<SearchHit[]> {
  const needle = normalizeQuery(query);
  if (needle.length < 2) return [];
  const tokens = needle.split(' ');
  const index = await loadIndex();
  if (!index) return allowFallback ? fallbackSearch(needle, tokens) : [];
  const hits: SearchHit[] = [];
  for (const r of index) {
    const s = scoreRow(tokens, norm(r.title), norm(r.category), norm(r.desc));
    if (!s) continue;
    hits.push({
      id: r.id, slug: r.slug ?? null, title: r.title || '', price: Number(r.price) || 0,
      images: r.thumb ? [r.thumb] : [], category: r.category ?? null, score: s,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

/** Same-category products from the static index (no DB). */
export async function relatedFromIndex(hits: SearchHit[], limit = 10): Promise<SearchHit[]> {
  const index = await loadIndex();
  if (!index || !hits.length) return [];
  const cats = new Set(hits.map((h) => h.category).filter(Boolean));
  const ids = new Set(hits.map((h) => h.id));
  return index
    .filter((r) => cats.has(r.category ?? null) && !ids.has(r.id))
    .slice(0, limit)
    .map((r) => ({ id: r.id, slug: r.slug ?? null, title: r.title || '', price: Number(r.price) || 0,
      images: r.thumb ? [r.thumb] : [], category: r.category ?? null, score: 0 }));
}
