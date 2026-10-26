import { useEffect } from 'react';

export function useSurfaceMotion(route: string, reducedMotion: boolean) {
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const selector =
      '.funding-route, .dashboard-cashflow, .feed-card, .product-card, .bank-card, .nav-item, .button.primary';
    let active: HTMLElement | null = null;
    let frame = 0;
    let x = 50;
    let y = 50;
    let targetX = 50;
    let targetY = 50;
    const clear = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (active) {
        active.removeAttribute('data-pointer-active');
        for (const key of ['--pointer-x', '--pointer-y', '--pointer-dx', '--pointer-dy'])
          active.style.removeProperty(key);
      }
      active = null;
    };
    const draw = () => {
      frame = 0;
      if (!active) return;
      x += (targetX - x) * 0.18;
      y += (targetY - y) * 0.18;
      active.style.setProperty('--pointer-x', `${x.toFixed(2)}%`);
      active.style.setProperty('--pointer-y', `${y.toFixed(2)}%`);
      active.style.setProperty('--pointer-dx', `${((x - 50) * 0.1).toFixed(2)}px`);
      active.style.setProperty('--pointer-dy', `${((y - 50) * 0.08).toFixed(2)}px`);
      if (Math.abs(targetX - x) + Math.abs(targetY - y) > 0.1) frame = requestAnimationFrame(draw);
    };
    const move = (event: PointerEvent) => {
      if (reducedMotion || motion.matches || !pointer.matches || event.pointerType === 'touch')
        return;
      const next =
        event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
      if (!next || next.matches(':disabled') || document.hidden) return clear();
      if (next !== active) {
        clear();
        active = next;
        x = y = 50;
        active.setAttribute('data-pointer-active', 'true');
      }
      const rect = active.getBoundingClientRect();
      targetX = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
      targetY = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
      if (!frame) frame = requestAnimationFrame(draw);
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', clear);
    document.addEventListener('visibilitychange', clear);
    window.addEventListener('blur', clear);
    window.addEventListener('scroll', clear, { passive: true, capture: true });
    motion.addEventListener('change', clear);
    pointer.addEventListener('change', clear);
    return () => {
      clear();
      document.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', clear);
      document.removeEventListener('visibilitychange', clear);
      window.removeEventListener('blur', clear);
      window.removeEventListener('scroll', clear, true);
      motion.removeEventListener('change', clear);
      pointer.removeEventListener('change', clear);
    };
  }, [route, reducedMotion]);
}
