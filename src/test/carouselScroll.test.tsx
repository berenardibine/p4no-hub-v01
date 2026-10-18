import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCarouselScroll } from '@/hooks/useCarouselScroll';

afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup(reduced = false, count = 8) {
  vi.useFakeTimers();
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
  const hook = renderHook(() => useCarouselScroll(1000, count));
  const node = document.createElement('div');
  Object.defineProperties(node, { scrollWidth: { value: 1200 }, clientWidth: { value: 300 } });
  node.getBoundingClientRect = () => ({ top: 100, bottom: 200 } as DOMRect);
  node.scrollTo = vi.fn();
  hook.result.current.scrollRef.current = node;
  return { hook, node };
}
describe('carousel movement rules', () => {
  it('moves only the horizontal rail and stops at the last item', () => {
    const { node } = setup();
    act(() => vi.advanceTimersByTime(1000));
    expect(node.scrollTo).toHaveBeenCalledWith({ left: 165, behavior: 'smooth' });
    node.scrollLeft = 900;
    vi.mocked(node.scrollTo).mockClear();
    act(() => vi.advanceTimersByTime(5000));
    expect(node.scrollTo).not.toHaveBeenCalled();
  });
  it('stops after manual touch and stays stopped', () => {
    const { hook, node } = setup();
    act(() => hook.result.current.handlers.onTouchStart());
    act(() => vi.advanceTimersByTime(5000));
    expect(node.scrollTo).not.toHaveBeenCalled();
  });
  it('pauses when keyboard focus enters the carousel', () => {
    const { hook, node } = setup();
    act(() => hook.result.current.handlers.onFocusCapture());
    act(() => vi.advanceTimersByTime(5000));
    expect(node.scrollTo).not.toHaveBeenCalled();
  });
  it('does not auto-move when reduced motion is preferred', () => {
    const { node } = setup(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(node.scrollTo).not.toHaveBeenCalled();
  });
  it('does not rapidly repeat a two-item carousel', () => {
    const { node } = setup(false, 2);
    act(() => vi.advanceTimersByTime(5000));
    expect(node.scrollTo).not.toHaveBeenCalled();
  });
});