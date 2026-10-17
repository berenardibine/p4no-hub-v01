import { useEffect, useRef, useState } from 'react';

export function useCarouselScroll(interval: number, count: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (hovered || focused || interacted || reduced || count <= 2) return;
    const timer = window.setInterval(() => {
      const node = scrollRef.current;
      if (!node || document.hidden || node.getBoundingClientRect().bottom < 0 ||
        node.getBoundingClientRect().top > window.innerHeight) return;
      const max = node.scrollWidth - node.clientWidth;
      // Stop at the last item rather than repeatedly looping a short rail.
      if (max <= 0 || node.scrollLeft >= max - 2) return;
      const card = node.firstElementChild as HTMLElement | null;
      node.scrollTo({ left: Math.min(max, node.scrollLeft + (card?.offsetWidth || 155) + 10), behavior: 'smooth' });
    }, interval);
    return () => window.clearInterval(timer);
  }, [interval, count, hovered, focused, interacted, reduced]);

  const stop = () => setInteracted(true);
  return {
    scrollRef,
    handlers: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onPointerDown: stop,
      onTouchStart: stop,
      onWheel: stop,
      onFocusCapture: () => setFocused(true),
      onBlurCapture: (event: React.FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      },
    },
    scroll: (dir: 'left' | 'right') => {
      stop();
      const node = scrollRef.current;
      if (!node) return;
      node.scrollTo({ left: node.scrollLeft + (dir === 'left' ? -300 : 300), behavior: reduced ? 'auto' : 'smooth' });
    },
  };
}