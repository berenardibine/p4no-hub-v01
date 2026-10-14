// Pure Product JSON-LD builder (Google Merchant listings). Mirrored in
// supabase/functions/prerender/index.ts — keep both in sync.
export interface ProductSchemaInput {
  name: string;
  description?: string | null;
  images?: (string | null | undefined)[];
  url: string;
  price?: unknown;
  currency?: string | null;
  sku?: string | null;
  category?: string | null;
  soldOut?: boolean;
  active?: boolean;
}

/** Numeric price > 0, or null. Accepts numbers or strings like "RWF 60,000". */
export function normalizePrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ISO 4217 code only; anything else (symbols like "Frw") falls back to RWF. */
export function normalizeCurrency(c?: string | null): string {
  return c && /^[A-Z]{3}$/.test(c.trim().toUpperCase()) ? c.trim().toUpperCase() : 'RWF';
}

export function buildProductSchema(p: ProductSchemaInput): Record<string, unknown> {
  const images = Array.from(new Set((p.images || []).filter((i): i is string => !!i && /^https:\/\//.test(i)))).slice(0, 10);
  const price = normalizePrice(p.price);
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    url: p.url,
  };
  const desc = (p.description || '').trim();
  if (desc) schema.description = desc.slice(0, 5000);
  if (images.length) schema.image = images;
  if (p.sku) schema.sku = p.sku;
  if (p.category) schema.category = p.category;
  if (price !== null) {
    schema.offers = {
      '@type': 'Offer',
      url: p.url,
      price,
      priceCurrency: normalizeCurrency(p.currency),
      availability: p.soldOut || p.active === false
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock',
    };
  }
  return schema;
}
