import { useEffect, useRef } from 'react';

export function useSurfacePointer<T extends HTMLElement>(enabled: boolean, strength = 12) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const surface = ref.current;
    if (!surface) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      ['--tilt-x', '--tilt-y', '--drift-x', '--drift-y', '--pointer-x', '--pointer-y'].forEach(
        (name) => surface.style.removeProperty(name),
      );
    };
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const move = (event: PointerEvent) => {
      if (!enabled || !fine.matches || event.pointerType === 'touch') return;
      const bounds = surface.getBoundingClientRect();
      x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
      y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
      if (frame) return;
      frame = requestAnimationFrame(() => {
        surface.style.setProperty('--tilt-x', `${x * strength}deg`);
        surface.style.setProperty('--tilt-y', `${-y * strength * 0.7}deg`);
        surface.style.setProperty('--drift-x', `${x * strength * 1.7}px`);
        surface.style.setProperty('--drift-y', `${y * strength * 1.2}px`);
        surface.style.setProperty('--pointer-x', `${50 + x * 50}%`);
        surface.style.setProperty('--pointer-y', `${50 + y * 50}%`);
        frame = 0;
      });
    };
    reset();
    surface.addEventListener('pointermove', move, { passive: true });
    surface.addEventListener('pointerleave', reset);
    fine.addEventListener('change', reset);
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerleave', reset);
      fine.removeEventListener('change', reset);
      document.removeEventListener('visibilitychange', reset);
      window.removeEventListener('blur', reset);
    };
  }, [enabled, strength]);
  return ref;
}
