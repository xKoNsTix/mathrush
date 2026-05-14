export type Op = "+" | "−" | "×" | "÷";

export interface Problem {
  a: number;
  b: number;
  op: Op;
  answer: number;
  text: string;
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Difficulty tiers driven by player level (1..N).
// Each tier defines allowed ops and ranges.
interface Tier {
  ops: Op[];
  range: () => { a: number; b: number; op: Op };
}

function addSub(maxA: number, maxB: number): { a: number; b: number; op: Op } {
  const op: Op = Math.random() < 0.5 ? "+" : "−";
  const a = rand(2, maxA);
  const b = rand(2, Math.min(maxB, a)); // keep − non-negative
  return { a, b, op };
}

function mul(maxA: number, maxB: number): { a: number; b: number; op: Op } {
  return { a: rand(2, maxA), b: rand(2, maxB), op: "×" };
}

function div(maxAns: number, maxB: number): { a: number; b: number; op: Op } {
  const b = rand(2, maxB);
  const ans = rand(2, maxAns);
  return { a: b * ans, b, op: "÷" };
}

const tiers: Tier[] = [
  // Level 1 — Aufwärmen
  { ops: ["+", "−"], range: () => addSub(20, 12) },
  // Level 2
  { ops: ["+", "−"], range: () => addSub(40, 25) },
  // Level 3 — kleine Multiplikation rein
  {
    ops: ["+", "−", "×"],
    range: () =>
      Math.random() < 0.65 ? addSub(60, 40) : mul(10, 10),
  },
  // Level 4 — Division
  {
    ops: ["+", "−", "×", "÷"],
    range: () => {
      const r = Math.random();
      if (r < 0.45) return addSub(80, 60);
      if (r < 0.8) return mul(12, 10);
      return div(10, 9);
    },
  },
  // Level 5
  {
    ops: ["+", "−", "×", "÷"],
    range: () => {
      const r = Math.random();
      if (r < 0.4) return addSub(120, 80);
      if (r < 0.75) return mul(15, 12);
      return div(12, 11);
    },
  },
  // Level 6 — knackiger
  {
    ops: ["+", "−", "×", "÷"],
    range: () => {
      const r = Math.random();
      if (r < 0.35) return addSub(200, 140);
      if (r < 0.75) return mul(19, 14);
      return div(15, 13);
    },
  },
  // Level 7+ Endless-Härte
  {
    ops: ["+", "−", "×", "÷"],
    range: () => {
      const r = Math.random();
      if (r < 0.3) return addSub(350, 250);
      if (r < 0.7) return mul(25, 18);
      return div(20, 17);
    },
  },
];

export function levelFromSolved(solved: number): number {
  // 1..7 — danach bleibt es auf 7
  return Math.min(tiers.length, Math.floor(solved / 8) + 1);
}

export function generate(level: number, last?: Problem): Problem {
  const tier = tiers[Math.min(tiers.length, Math.max(1, level)) - 1];
  for (let i = 0; i < 6; i++) {
    const { a, b, op } = tier.range();
    const answer = compute(a, b, op);
    const text = `${a} ${op} ${b}`;
    if (!last || last.text !== text) {
      return { a, b, op, answer, text };
    }
  }
  const { a, b, op } = tier.range();
  return { a, b, op, answer: compute(a, b, op), text: `${a} ${op} ${b}` };
}

function compute(a: number, b: number, op: Op): number {
  switch (op) {
    case "+": return a + b;
    case "−": return a - b;
    case "×": return a * b;
    case "÷": return a / b;
  }
}

/** Erzeugt 4 plausible Antwort-Optionen (1× richtig + 3× Distraktor),
 *  zufällig verteilt. Distraktoren orientieren sich an typischen
 *  Fehlern: falsche Operation (a+b statt a−b), Off-by-one, ±10. */
export function generateChoices(problem: Problem): number[] {
  const { a, b, op, answer } = problem;
  const candidates: number[] = [];

  switch (op) {
    case "+":
      candidates.push(a - b, b - a, answer + 1, answer - 1, answer + 10, answer - 10, a * b);
      break;
    case "−":
      candidates.push(a + b, b - a, answer + 1, answer - 1, answer + 10, answer - 10);
      break;
    case "×":
      candidates.push(a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b, a + b, answer + 1, answer - 1);
      break;
    case "÷":
      candidates.push(answer + 1, answer - 1, answer * 2, Math.floor(answer / 2), a - b, a + b);
      break;
  }

  const set = new Set<number>([answer]);
  for (const c of candidates) {
    if (set.size >= 4) break;
    if (c < 0) continue;
    if (c === answer) continue;
    set.add(c);
  }
  // Fallback: kleine Nachbarn falls obige Liste zu wenig liefert
  let bump = 2;
  while (set.size < 4 && bump < 50) {
    const c = answer + (Math.random() < 0.5 ? -bump : bump);
    if (c >= 0 && !set.has(c)) set.add(c);
    bump++;
  }

  const arr = [...set];
  // Fisher-Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
