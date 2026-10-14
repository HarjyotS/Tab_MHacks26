// Layout audit: on sampled frames, measure every [data-box] element and log
// (a) overlapping boxes and (b) text rendered below the readability floor.
// Render with --props='{"audit":true}' and read the AUDIT lines from the log.
import { useEffect } from 'react';
import { useCurrentFrame } from 'remotion';

const MIN_TEXT = 30; // px, effective on the 1920×1080 frame (Q11 aux floor ≈32)
const MIN_CAPTION = 56;

const effOpacity = (el: Element | null): number => {
  let o = 1;
  for (let n = el as HTMLElement | null; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    o *= parseFloat(cs.opacity || '1');
    if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
  }
  return o;
};

// Boxes inside a scrolling viewport marked [data-clip] are measured only where they are visible.
const clipRect = (el: Element, r: DOMRect): DOMRect | null => {
  let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
  for (let n = el.parentElement?.closest('[data-clip]'); n; n = n.parentElement?.closest('[data-clip]')) {
    const c = n.getBoundingClientRect();
    x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom);
  }
  return x1 - x0 > 2 && y1 - y0 > 2 ? new DOMRect(x0, y0, x1 - x0, y1 - y0) : null;
};

/** `safe`: optional uniform safe margin in px (default 40 horizontal / 24 vertical). */
export const Audit: React.FC<{ every?: number; safe?: number }> = ({ every = 10, safe }) => {
  const frame = useCurrentFrame();
  useEffect(() => {
    if (frame % every !== 0) return;
    const SX = safe ?? 40;
    const SY = safe ?? 24;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-box]'));
    const boxes = els
      .map((el) => ({ el, name: el.dataset.box!, r: clipRect(el, el.getBoundingClientRect()), o: effOpacity(el), overlay: el.closest('[data-overlay]') !== null }))
      .filter((b): b is typeof b & { r: DOMRect } => b.r !== null)
      .filter((b) => b.o > 0.15 && b.r.width > 2 && b.r.height > 2 && b.r.right > 0 && b.r.bottom > 0 && b.r.left < 1920 && b.r.top < 1080);
    const issues: string[] = [];
    // safe area: nothing within 40px of the frame edge (full-bleed layers opt out with data-bleed)
    for (const b of boxes) {
      if (b.el.closest('[data-bleed]')) continue;
      if (b.r.left < SX || b.r.right > 1920 - SX || b.r.top < SY || b.r.bottom > 1080 - SY)
        issues.push(`EDGE ${b.name} [${Math.round(b.r.left)},${Math.round(b.r.top)},${Math.round(b.r.right)},${Math.round(b.r.bottom)}]`);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.overlay || b.overlay) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w <= 4 || h <= 4) continue;
        const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
        const frac = (w * h) / small;
        if (frac > 0.03) issues.push(`OVERLAP ${a.name} × ${b.name} ${(frac * 100).toFixed(0)}%`);
      }
    }
    // text size: every element that directly holds text
    const texts = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) =>
      Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1),
    );
    for (const el of texts) {
      const o = effOpacity(el);
      if (o < 0.5) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.right < 0 || r.left > 1920 || r.bottom < 0 || r.top > 1080) continue;
      if (!clipRect(el, r)) continue; // scrolled out of its viewport
      if (el.closest('[data-texture]')) continue; // intentionally unreadable texture (Q11)
      const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
      const size = parseFloat(getComputedStyle(el).fontSize) * scale;
      const isCaption = el.closest('[data-box^="caption"]') !== null;
      const floor = isCaption ? MIN_CAPTION : MIN_TEXT;
      if (size < floor - 0.5) issues.push(`SMALL ${size.toFixed(0)}px<${floor} "${(el.textContent ?? '').trim().slice(0, 40)}"`);
    }
    if (issues.length) console.log(`AUDIT f${frame} ${JSON.stringify(issues)}`);
  }, [frame, every, safe]);
  return null;
};
