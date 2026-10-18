import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDynamicHomeFeed } from '@/hooks/useDynamicHomeFeed';
import { getCachedCategories, getCachedList, getDiscoveryIndex, getDiscoveryPage } from '@/lib/productCache';

vi.mock('@/lib/productCache', () => ({ getCachedCategories: vi.fn(), getCachedList: vi.fn(), getDiscoveryIndex: vi.fn(), getDiscoveryPage: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const categories = [{ id: 'c1', slug: 'common', name: 'Common', icon: null, type: null }, { id: 'c2', slug: 'rare', name: 'Rare', icon: null, type: null }];
const product = (id: string, category = 'common') => ({ id, title: id, category, status: 'active', price: 100, images: [] });
function setup(pages = [[product('a'), product('b'), product('rare-one', 'rare')], [product('c'), product('d')]]) {
  vi.mocked(getCachedCategories).mockResolvedValue(categories);
  vi.mocked(getCachedList).mockResolvedValue([product('a')]);
  vi.mocked(getDiscoveryIndex).mockResolvedValue({ total: 5, pageCount: pages.length, pageSize: 40 });
  vi.mocked(getDiscoveryPage).mockImplementation(async page => pages[page] || []);
  return pages;
}
function ids(result: ReturnType<typeof useDynamicHomeFeed>) {
  const rows = result.dynamicFeed.flatMap(item => item.type === 'products' ? item.data as any[] : (item.data as any).products);
  return [...result.newArrivals, ...(result.topCategory?.products || []), ...rows].map(row => row.id);
}
describe('homepage section allocation', () => {
  it('shares IDs with arrivals, presents rare categories, and starts a new cycle only after exhaustion', async () => {
    setup();
    const { result } = renderHook(() => useDynamicHomeFeed(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.loadMore());
    expect(result.current.exhausted).toBe(true);
    expect(ids(result.current).sort()).toEqual(['a', 'b', 'c', 'd', 'rare-one']);
    const sections = [result.current.topCategory, ...result.current.dynamicFeed.filter(item => item.type === 'category').map(item => item.data as any)].filter(Boolean);
    expect(sections.map(section => section?.category.id).sort()).toEqual(['c1', 'c2']);
    for (const section of sections) expect(section?.products.every((p: any) => p.category === section.category.slug)).toBe(true);
    act(() => result.current.startNextCycle());
    await waitFor(() => expect(ids(result.current).length).toBeGreaterThan(5));
  });
  it('does not advance or mark IDs seen when a page fails, allowing retry', async () => {
    setup([[product('a')]]);
    vi.mocked(getDiscoveryPage).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useDynamicHomeFeed(null, false));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.hasMore).toBe(true);
    await act(() => result.current.loadMore());
    expect(ids(result.current)).toEqual(['a']);
    expect(result.current.error).toBeNull();
  });
  it('reconciles sold-out and newly added products on manifest change without duplicating retained IDs', async () => {
    const pages = setup([[product('a'), product('b')]]);
    const { result } = renderHook(() => useDynamicHomeFeed(null, false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    pages[0] = [product('b'), product('new')];
    act(() => window.dispatchEvent(new Event('p4no:manifest-updated')));
    await waitFor(() => expect(ids(result.current).sort()).toEqual(['b', 'new']));
    expect(new Set(ids(result.current)).size).toBe(2);
  });
});