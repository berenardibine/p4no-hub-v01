import { isProductSoldOut } from './productStock';

export interface DiscoveryProduct {
  id: string;
  status?: string | null;
  country?: string | null;
  category?: string | null;
  description_structured?: unknown;
  [key: string]: any;
}

export function eligibleProduct(product: DiscoveryProduct, country?: string | null) {
  return !!product.id && (!product.status || product.status === 'active') &&
    !isProductSoldOut(product) && (!country || product.country === country);
}

// Deterministic per-cycle shuffle: no random sorting during renders.
export function shuffled<T>(values: T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((state / 4294967296) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export class DiscoveryCycle {
  seen = new Set<string>();
  visited = new Set<number>();
  order: number[] = [];
  cycle = 0;
  constructor(public seed: number) {}

  reconcile(pageCount: number) {
    const remaining = this.order.filter(page => page < pageCount && !this.visited.has(page));
    const added = Array.from({ length: pageCount }, (_, i) => i)
      .filter(page => !this.visited.has(page) && !remaining.includes(page));
    this.order = [...remaining, ...shuffled(added, this.seed + this.cycle)];
  }

  get nextPage() { return this.order[0]; }
  get exhausted() { return this.order.length === 0; }

  consume(page: number, rows: DiscoveryProduct[], country?: string | null) {
    const unique = shuffled(rows, this.seed + this.cycle * 7919 + page);
    const result = unique.filter(row => {
      if (!eligibleProduct(row, country) || this.seen.has(row.id)) return false;
      this.seen.add(row.id);
      return true;
    });
    this.visited.add(page);
    this.order = this.order.filter(value => value !== page);
    return result;
  }

  restart(pageCount: number) {
    if (!this.exhausted) return false;
    this.cycle++;
    this.seen.clear();
    this.visited.clear();
    this.reconcile(pageCount);
    // Adjacent cycles use a visibly different page order whenever possible.
    if (this.order.length > 1) this.order.push(...this.order.splice(0, this.cycle % this.order.length || 1));
    return true;
  }
}

export function categoryMatches(product: DiscoveryProduct, category: { id: string; slug: string; name: string }) {
  return [category.id, category.slug, category.name].includes(product.category || '');
}