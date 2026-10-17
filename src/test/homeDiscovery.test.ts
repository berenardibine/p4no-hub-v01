import { describe, expect, it } from 'vitest';
import { DiscoveryCycle, categoryMatches, eligibleProduct, shuffled } from '@/lib/homeDiscovery';

describe('homepage discovery rules', () => {
  it('exhausts every page including older products before starting another cycle', () => {
    const cycle = new DiscoveryCycle(42);
    cycle.reconcile(31);
    expect(cycle.restart(31)).toBe(false);
    const ids: string[] = [];
    while (!cycle.exhausted) {
      const page = cycle.nextPage;
      if (page === undefined) break;
      ids.push(...cycle.consume(page, [{ id: `product-${page}` }, { id: 'shared' }]).map(row => row.id));
    }
    expect(ids.length).toBe(32);
    expect(new Set(ids).size).toBe(32);
    expect(ids).toContain('product-30');
    expect(cycle.restart(31)).toBe(true);
    expect(cycle.cycle).toBe(1);
    expect(cycle.seen.size).toBe(0);
  });

  it('keeps a stable sequence until pages change and appends new pages without resetting seen IDs', () => {
    const cycle = new DiscoveryCycle(17);
    cycle.reconcile(4);
    const page = cycle.nextPage;
    if (page === undefined) throw new Error('Missing page');
    cycle.consume(page, [{ id: 'already-seen' }]);
    const order = [...cycle.order];
    cycle.reconcile(6);
    expect(cycle.order.slice(0, order.length)).toEqual(order);
    expect(cycle.order).toContain(4);
    expect(cycle.order).toContain(5);
    expect(cycle.consume(page, [{ id: 'already-seen' }, { id: 'added' }]).map(row => row.id)).toEqual(['added']);
    cycle.reconcile(2);
    expect(cycle.order.every(value => value < 2)).toBe(true);
  });

  it('filters unpublished and sold-out rows and respects exact country selection', () => {
    expect(eligibleProduct({ id: 'a', status: 'draft' })).toBe(false);
    expect(eligibleProduct({ id: 'a', status: 'active', description_structured: { sold_out: true } })).toBe(false);
    expect(eligibleProduct({ id: 'a', status: 'active', country: 'Rwanda' }, 'Rwanda')).toBe(true);
    expect(eligibleProduct({ id: 'a', country: null }, 'Rwanda')).toBe(false);
    expect(eligibleProduct({ id: 'a', quantity: 0, unlimited_quantity: true })).toBe(true);
  });

  it('matches assigned category identifiers without including unrelated products', () => {
    const category = { id: 'cat-1', slug: 'electronics', name: 'Electronics' };
    for (const value of ['cat-1', 'electronics', 'Electronics']) expect(categoryMatches({ id: 'p', category: value }, category)).toBe(true);
    expect(categoryMatches({ id: 'p', category: 'fashion' }, category)).toBe(false);
  });

  it('shuffles without dropping or duplicating products and changes order with a new seed', () => {
    const input = Array.from({ length: 40 }, (_, i) => i);
    expect(shuffled(input, 42)).toEqual(shuffled(input, 42));
    expect(new Set(shuffled(input, 42)).size).toBe(40);
    expect(shuffled(input, 43)).not.toEqual(shuffled(input, 42));
    expect(input[0]).toBe(0);
  });
});