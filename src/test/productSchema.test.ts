import { describe, it, expect } from 'vitest';
import { buildProductSchema, normalizePrice } from '@/lib/productSchema';
const base = { name: 'Watch', url: 'https://p4nohub.online/product/w' };
describe('product schema', () => {
  it('parses formatted RWF price to number', () => expect(normalizePrice('RWF 60,000')).toBe(60000));
  it('omits offer when price missing or zero', () => {
    expect(buildProductSchema({ ...base, price: 0 }).offers).toBeUndefined();
    expect(buildProductSchema({ ...base, price: null }).offers).toBeUndefined();
  });
  it('sold out is not InStock', () => {
    expect((buildProductSchema({ ...base, price: 60000, soldOut: true }).offers as any).availability).toBe('https://schema.org/OutOfStock');
  });
  it('uses ISO currency', () => {
    expect((buildProductSchema({ ...base, price: 60000, currency: 'Frw' }).offers as any).priceCurrency).toBe('RWF');
  });
  it('never emits ratings', () => expect(buildProductSchema({ ...base, price: 1 }).aggregateRating).toBeUndefined());
});
