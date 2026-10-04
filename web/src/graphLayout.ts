// Geometry for the "Who owes whom" graph. People are name pills on a circle;
// each debt is a curved arrow that bends to the left of its direction, so
// A→B and B→A separate and crossing diagonals don't meet in the middle.
// Arrows stop at the pill's edge, and each amount label takes the spot along
// its arrow that clears every pill and label and is crossed by the fewest
// other arrows.

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number }; // centered at x, y

export const PILL_H = 36;
const LABEL_H = 22;
const PAD = 4; // breathing room between boxes

export const pillWidth = (name: string) => Math.max(64, Math.round(name.length * 8.5) + 30);

export function centers(count: number): { centers: Pt[]; radius: number } {
  // Room grows with the group, so neighbours never crowd each other.
  const radius = count <= 2 ? 140 : Math.max(170, count * 42);
  return {
    radius,
    centers: Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / Math.max(count, 1) - Math.PI / 2;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }),
  };
}

export const pillBox = (c: Pt, name: string): Box => ({ x: c.x, y: c.y, w: pillWidth(name), h: PILL_H });
export const labelBox = (at: Pt, text: string): Box => ({ x: at.x, y: at.y, w: text.length * 7.6 + 18, h: LABEL_H });

export const overlaps = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + PAD * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + PAD * 2;
export const inside = (p: Pt, b: Box, pad = 0) =>
  Math.abs(p.x - b.x) * 2 < b.w + pad * 2 && Math.abs(p.y - b.y) * 2 < b.h + pad * 2;

export type Curve = { s: Pt; c: Pt; e: Pt };
export const pointAt = ({ s, c, e }: Curve, t: number): Pt => ({
  x: (1 - t) ** 2 * s.x + 2 * (1 - t) * t * c.x + t ** 2 * e.x,
  y: (1 - t) ** 2 * s.y + 2 * (1 - t) * t * c.y + t ** 2 * e.y,
});
// A point on the curve, moved `off` px along its normal.
const nudge = (k: Curve, t: number, off: number): Pt => {
  const p = pointAt(k, t);
  const dx = 2 * (1 - t) * (k.c.x - k.s.x) + 2 * t * (k.e.x - k.c.x);
  const dy = 2 * (1 - t) * (k.c.y - k.s.y) + 2 * t * (k.e.y - k.c.y);
  const len = Math.hypot(dx, dy) || 1;
  return { x: p.x - (dy / len) * off, y: p.y + (dx / len) * off };
};
// Where the ray from a pill's center toward `to` leaves the pill, plus a gap.
const exit = (box: Box, to: Pt, gap: number): Pt => {
  const dx = to.x - box.x, dy = to.y - box.y, len = Math.hypot(dx, dy) || 1;
  const scale = Math.min(Math.abs(box.w / 2 / (dx || 1e-9)), Math.abs(box.h / 2 / (dy || 1e-9)));
  return { x: box.x + dx * scale + (dx / len) * gap, y: box.y + dy * scale + (dy / len) * gap };
};

export function curve(from: Box, to: Box, depth = 0.28): Curve {
  const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
  const bend = Math.sign(depth) * Math.max(36, len * Math.abs(depth));
  // Left of the direction of travel: the reverse debt bends the other way.
  const c = { x: (from.x + to.x) / 2 - (dy / len) * bend, y: (from.y + to.y) / 2 + (dx / len) * bend };
  return { s: exit(from, c, 5), c, e: exit(to, c, 9) }; // + room for the arrowhead
}

export type Person = { center: Pt; name: string };
export type EdgeIn = { id: string; from: Person; to: Person; label: string };
export type EdgeOut = { id: string; path: string; curve: Curve; label: Pt; box: Box };

const TRIES = Array.from({ length: 31 }, (_, i) => 0.2 + i * 0.02).sort((a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5));
const OFFSETS = [0, 14, -14, 26, -26];
const SAMPLES = Array.from({ length: 41 }, (_, i) => i / 40);
const DEPTHS = [0.28, 0.18, 0.4, 0.1, 0.52, -0.18, -0.28];

export function layoutEdges(edges: EdgeIn[], people: Person[]): EdgeOut[] {
  const pills = people.map((p) => pillBox(p.center, p.name));
  // The usual bend unless it runs through someone else's pill; then gentler
  // or deeper, and only as a last resort the other side.
  const curves = edges.map((e) => {
    const from = pillBox(e.from.center, e.from.name), to = pillBox(e.to.center, e.to.name);
    const others = pills.filter((b) => b !== pills[people.indexOf(e.from)] && b !== pills[people.indexOf(e.to)]);
    const clear = (k: Curve) => !SAMPLES.some((t) => others.some((b) => inside(pointAt(k, t), b, 3)));
    const options = DEPTHS.map((d) => curve(from, to, d));
    return options.find(clear) ?? options[0]!;
  });
  const samples = curves.map((k) => SAMPLES.map((t) => pointAt(k, t)));
  const taken: Box[] = [...pills];
  return edges.map((edge, i) => {
    const k = curves[i]!;
    // Clear of pills and placed labels first; then the fewest foreign
    // arrows through it; then closest to the middle of its own arrow.
    let best: { box: Box; score: number } | undefined;
    OFFSETS.forEach((off, o) =>
      TRIES.forEach((t, n) => {
        const box = labelBox(nudge(k, t, off), edge.label);
        if (taken.some((b) => overlaps(box, b))) return;
        const crossings = samples.reduce((sum, pts, j) => sum + (j !== i && pts.some((p) => inside(p, box, 2)) ? 1 : 0), 0);
        const score = crossings * 1000 + o * 40 + n;
        if (!best || score < best.score) best = { box, score };
      }),
    );
    const box = best?.box ?? labelBox(pointAt(k, 0.5), edge.label);
    taken.push(box);
    return { id: edge.id, path: `M ${k.s.x} ${k.s.y} Q ${k.c.x} ${k.c.y} ${k.e.x} ${k.e.y}`, curve: k, label: { x: box.x, y: box.y }, box };
  });
}

// Everything drawn (pills, arrows, labels), so the view can fit all of it.
export function extent(people: Person[], edges: EdgeOut[]): { min: Pt; max: Pt } {
  const pts: Pt[] = [];
  for (const p of people) {
    const b = pillBox(p.center, p.name);
    pts.push({ x: b.x - b.w / 2, y: b.y - b.h / 2 }, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  }
  for (const e of edges) {
    pts.push(...SAMPLES.map((t) => pointAt(e.curve, t)));
    pts.push({ x: e.box.x - e.box.w / 2, y: e.box.y - e.box.h / 2 }, { x: e.box.x + e.box.w / 2, y: e.box.y + e.box.h / 2 });
  }
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
  };
}
