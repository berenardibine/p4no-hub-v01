import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getCachedCategories, getCachedList, getDiscoveryIndex, getDiscoveryPage } from '@/lib/productCache';
import { DiscoveryCycle, categoryMatches, eligibleProduct } from '@/lib/homeDiscovery';

interface Product {
  id: string;
  title: string;
  price: number;
  images: string[];
  category: string | null;
  created_at: string | null;
  views: number | null;
  likes: number | null;
  rental_unit: string | null;
  sponsored: boolean | null;
  product_type: string | null;
  country: string | null;
  currency_code: string | null;
  currency_symbol: string | null;
  is_negotiable: boolean | null;
  admin_posted: boolean | null;
  discount: number | null;
  discount_expiry: string | null;
  location?: string | null;
  seller?: {
    id: string;
    full_name: string;
    profile_image: string | null;
  } | null;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  type: string | null;
}

interface CategorySection {
  category: Category;
  products: Product[];
  color: string;
}

// Category color gradients
const categoryColors = [
  'from-orange-500 to-amber-400',
  'from-green-500 to-emerald-400',
  'from-blue-500 to-cyan-400',
  'from-purple-500 to-violet-400',
  'from-pink-500 to-rose-400',
  'from-teal-500 to-green-400',
  'from-indigo-500 to-blue-400',
  'from-red-500 to-orange-400',
];

// Icon mapping
const iconMap: Record<string, string> = {
  'asset': '🏠',
  'agriculture': '🌾',
  'rent': '🔧',
  'electronics': '💻',
  'fashion': '👕',
  'food': '🍔',
  'health': '💪',
  'furniture': '🛋️',
  'default': '📦',
};

interface PageBlock { page: number; cycle: number; products: Product[] }

export const useDynamicHomeFeed = (userCountry?: string | null, arrivalsEnabled = true) => {
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [arrivals, setArrivals] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engine = useRef(new DiscoveryCycle(Math.floor(Math.random() * 4294967296)));
  const count = useRef(0);
  const busy = useRef(false);
  const generation = useRef(0);
  const blocksRef = useRef<PageBlock[]>([]);
  const commit = useCallback((next: PageBlock[]) => {
    blocksRef.current = next;
    setBlocks(next);
  }, []);

  const loadMore = useCallback(async () => {
    if (busy.current || engine.current.exhausted) return;
    busy.current = true;
    setLoadingMore(true);
    const token = generation.current;
    try {
      // Skip empty country pages, but never confuse a failed page with exhaustion.
      let added = false;
      while (!engine.current.exhausted && !added) {
        const page = engine.current.nextPage;
        if (page === undefined) break;
        const rows = await getDiscoveryPage(page);
        if (token !== generation.current) return;
        if (!Array.isArray(rows)) throw new Error('Products could not be loaded. Please try again.');
        const products = engine.current.consume(page, rows, userCountry) as Product[];
        if (products.length) {
          commit([...blocksRef.current, { page, cycle: engine.current.cycle, products }]);
          added = true;
        }
      }
      setError(null);
      setHasMore(!engine.current.exhausted);
      setExhausted(engine.current.exhausted);
    } catch (e) {
      if (token === generation.current) setError(e instanceof Error ? e.message : 'Products could not be loaded.');
    } finally {
      if (token === generation.current) {
        busy.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [userCountry, commit]);

  const refetch = useCallback(async () => {
    const token = ++generation.current;
    busy.current = true;
    setLoading(true);
    try {
      const [index, cats, latest] = await Promise.all([
        getDiscoveryIndex(), getCachedCategories(), arrivalsEnabled ? getCachedList('latest', 0, 60) : Promise.resolve([]),
      ]);
      if (token !== generation.current) return;
      if (!index || !Array.isArray(cats)) throw new Error('Products could not be loaded. Please try again.');
      count.current = index.pageCount;
      engine.current = new DiscoveryCycle(engine.current.seed);
      engine.current.reconcile(index.pageCount);
      const fresh = (latest || []).filter(product => eligibleProduct(product, userCountry)).slice(0, 8);
      const unique = fresh.filter(product => {
        if (engine.current.seen.has(product.id)) return false;
        engine.current.seen.add(product.id);
        return true;
      });
      setArrivals(unique);
      setCategories(cats);
      commit([]);
      setError(null);
      setHasMore(index.pageCount > 0);
      setExhausted(index.pageCount === 0);
      busy.current = false;
      if (index.pageCount) await loadMore();
    } catch (e) {
      if (token === generation.current) setError(e instanceof Error ? e.message : 'Products could not be loaded.');
    } finally {
      if (token === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [loadMore, commit, arrivalsEnabled, userCountry]);

  useEffect(() => {
    void refetch();
    return () => { generation.current++; busy.current = false; };
  }, [refetch]);

  // Revalidate only in response to the existing manifest event; no polling.
  // Retain sequence positions and IDs while removing newly ineligible rows.
  useEffect(() => {
    const refresh = async () => {
      if (busy.current || loading) return;
      busy.current = true;
      const token = generation.current;
      try {
        const [index, cats] = await Promise.all([getDiscoveryIndex(), getCachedCategories()]);
        if (!index || !cats || token !== generation.current) return;
        // Read only previously visited pages (including empty country pages).
        // Build the lookup before mutating seen state so a failed read is retryable.
        const pages = new Map<number, any[]>();
        const requested = new Set([...engine.current.visited, ...blocksRef.current.map(block => block.page)]);
        for (const page of requested) {
          if (page >= index.pageCount) continue;
          const rows = await getDiscoveryPage(page);
          if (token !== generation.current) return;
          if (!rows) throw new Error('Updated products could not be loaded. Please try again.');
          pages.set(page, rows);
        }
        const latest = arrivalsEnabled ? await getCachedList('latest', 0, 60) : [];
        if (token !== generation.current) return;
        const byId = new Map([...pages.values()].flat().concat(latest || []).map(row => [row.id, row]));
        const keep = (products: Product[]) => products.flatMap(product => {
          const fresh = byId.get(product.id);
          return fresh && eligibleProduct(fresh, userCountry) ? [fresh] : [];
        });
        const next = blocksRef.current.map(block => ({ ...block, products: keep(block.products) }));
        count.current = index.pageCount;
        engine.current.reconcile(index.pageCount);
        for (const [page, rows] of pages) {
          const additions = engine.current.consume(page, rows, userCountry) as Product[];
          const block = next.find(value => value.page === page && value.cycle === engine.current.cycle);
          if (block) block.products.push(...additions);
          else if (additions.length) next.push({ page, cycle: engine.current.cycle, products: additions });
        }
        setArrivals(previous => keep(previous));
        commit(next);
        setCategories(cats);
        setError(null);
        setHasMore(!engine.current.exhausted);
        setExhausted(engine.current.exhausted);
      } catch { setError('Updated products could not be loaded. Please try again.'); }
      finally { if (token === generation.current) busy.current = false; }
    };
    window.addEventListener('p4no:manifest-updated', refresh);
    return () => window.removeEventListener('p4no:manifest-updated', refresh);
  }, [loading, userCountry, commit, arrivalsEnabled]);

  const startNextCycle = useCallback(() => {
    if (busy.current || !engine.current.restart(count.current)) return;
    setHasMore(count.current > 0);
    setExhausted(false);
    void loadMore();
  }, [loadMore]);

  const allocation = useMemo(() => {
    const feed: Array<{ key: string; type: 'products' | 'category'; data: Product[] | CategorySection }> = [];
    const usedCategories = new Set<string>();
    blocks.forEach((block) => {
      let remaining = [...block.products];
      let group = 0;
      while (remaining.length) {
        // Each category occurs once per cycle and takes ownership of its cards.
        const cat = categories.find(category => !usedCategories.has(`${block.cycle}:${category.id}`) &&
          remaining.some(product => categoryMatches(product, category)));
        if (cat) {
          usedCategories.add(`${block.cycle}:${cat.id}`);
          const matching = remaining.filter(product => categoryMatches(product, cat)).slice(0, 6);
          const ids = new Set(matching.map(product => product.id));
          remaining = remaining.filter(product => !ids.has(product.id));
          feed.push({ key: `category-${block.cycle}-${cat.id}`, type: 'category', data: {
            category: { ...cat, icon: cat.icon || iconMap[cat.type || 'default'] || iconMap.default },
            products: matching, color: categoryColors[(usedCategories.size - 1) % categoryColors.length],
          } });
        }
        if (remaining.length) {
          // Reserve unseen categories for their own next section, even when
          // a rare category has only one product in the entire catalogue.
          const general = remaining.filter(product => !categories.some(category =>
            !usedCategories.has(`${block.cycle}:${category.id}`) && categoryMatches(product, category))).slice(0, 6);
          if (general.length) {
            const ids = new Set(general.map(product => product.id));
            feed.push({ key: `products-${block.cycle}-${block.page}-${group++}`, type: 'products', data: general });
            remaining = remaining.filter(product => !ids.has(product.id));
          }
        }
      }
    });
    const top = feed[0]?.type === 'category' ? feed[0] : null;
    return { newArrivals: arrivals, topCategory: top?.data as CategorySection | undefined,
      dynamicFeed: top ? feed.slice(1) : feed };
  }, [blocks, categories, arrivals]);

  return { ...allocation, loading, loadingMore, hasMore, exhausted, error, loadMore, refetch, startNextCycle };
};

export default useDynamicHomeFeed;
