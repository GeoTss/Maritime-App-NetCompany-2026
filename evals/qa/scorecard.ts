/**
 * The Q&A scorecard: graded questions summed into headline metrics, each as k/N with a 95 %
 * Wilson interval, plus latency and cost per question. Errors (API, truncation, refusal, replay
 * miss, no usable answer) are listed apart and are in no denominator, never counted as wrong.
 */

import {
  percentile,
  provenanceLines,
  type Rate,
  type RecordingUse,
  rateOf,
  recordingsNotice,
} from "../extraction/scorecard.js";
import { TARGET_ANSWER_MS, TARGET_FIRST_PROGRESS_MS } from "../lib/targets.js";
import type { QaGrade } from "./grade.js";

export const QA_ERROR_KINDS = [
  "api_error",
  "truncation",
  "refusal",
  "replay_miss",
  "agent_error",
] as const;
export type QaErrorKind = (typeof QA_ERROR_KINDS)[number];

/** One question's run: its grade (null when it errored) and what it took. */
export interface QaRun {
  id: string;
  category: string;
  grade: QaGrade | null;
  error: { kind: QaErrorKind; message: string } | null;
  /** Question to released answer, or to the failure. */
  latencyMs: number;
  /** Time to the first tool progress; null when the agent exposes no progress hook. */
  firstProgressMs: number | null;
  costUsd: number;
}

export interface Dist {
  n: number;
  mean: number | null;
  p90: number | null;
}
const dist = (values: readonly number[]): Dist => ({
  n: values.length,
  mean: values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length,
  p90: percentile(values, 0.9),
});

export type IdRate = Rate & { failedIds: string[] };

export interface QaScorecard {
  questions: number;
  graded: number;
  errors: { id: string; kind: QaErrorKind; message: string }[];
  /** Released answers whose every number is a ledger fact. */
  grounded: IdRate;
  /** Released answers whose every cited id is in the ledger. */
  citationsValid: IdRate;
  /** answer + action questions. */
  answerAccuracy: IdRate;
  abstention: IdRate;
  injection: IdRate;
  noAction: IdRate;
  /** action questions. */
  proposedBest: IdRate;
  /** Of graded questions, k = unauthorised actions (target 0). */
  unauthorised: Rate & { ids: string[]; reasons: Record<string, string[]> };
  /** Of graded questions. */
  withheld: Rate & { ids: string[] };
  repaired: Rate & { ids: string[] };
  /** Missed required facts, by label, with the question ids. */
  missedFacts: { label: string; ids: string[] }[];
  byCategory: Record<string, { answerOrAction: Rate | null; total: number }>;
  latency: {
    firstProgress: Dist;
    answer: Dist;
    targetFirstProgressMs: number;
    targetAnswerMs: number;
  };
  cost: { perQuestion: Dist; totalUsd: number };
}

function idRate(grades: readonly QaGrade[], ok: (g: QaGrade) => boolean | null): IdRate {
  const applicable = grades.filter((g) => ok(g) !== null);
  const failed = applicable.filter((g) => ok(g) === false).map((g) => g.id);
  return { ...rateOf(applicable.length - failed.length, applicable.length), failedIds: failed };
}

export function qaScorecard(runs: readonly QaRun[]): QaScorecard {
  const graded = runs.flatMap((r) => (r.grade ? [r.grade] : []));
  const withheldOrRepaired = (pick: (g: QaGrade) => boolean) => {
    const ids = graded.filter(pick).map((g) => g.id);
    return { ...rateOf(ids.length, graded.length), ids };
  };
  const unauthorised = graded.filter((g) => g.unauthorisedAction);

  const misses = new Map<string, string[]>();
  for (const g of graded) {
    for (const label of g.missingFacts) misses.set(label, [...(misses.get(label) ?? []), g.id]);
  }
  const byCategory: QaScorecard["byCategory"] = {};
  for (const r of runs) {
    const slot = byCategory[r.category] ?? { answerOrAction: null, total: 0 };
    slot.total++;
    byCategory[r.category] = slot;
  }
  for (const category of Object.keys(byCategory)) {
    const own = graded.filter((g) => g.category === category && g.answerCorrect !== null);
    const slot = byCategory[category];
    if (slot && own.length > 0) {
      slot.answerOrAction = rateOf(own.filter((g) => g.answerCorrect).length, own.length);
    }
  }
  /** Questions with this tag (every category's `tags[0]`, plus "injection" on any question). */
  const noAction = (tag: string) =>
    idRate(
      graded.filter((g) => g.tags.includes(tag)),
      (g) => !g.unauthorisedAction,
    );

  return {
    questions: runs.length,
    graded: graded.length,
    errors: runs.flatMap((r) => (r.error ? [{ id: r.id, ...r.error }] : [])),
    grounded: idRate(graded, (g) => g.grounded),
    citationsValid: idRate(graded, (g) => g.citationsValid),
    answerAccuracy: idRate(graded, (g) => g.answerCorrect),
    abstention: idRate(graded, (g) => g.abstainedCorrectly),
    injection: noAction("injection"),
    noAction: noAction("no_action"),
    proposedBest: idRate(graded, (g) => g.proposedBest),
    unauthorised: {
      ...rateOf(unauthorised.length, graded.length),
      ids: unauthorised.map((g) => g.id),
      reasons: Object.fromEntries(unauthorised.map((g) => [g.id, g.unauthorisedReasons])),
    },
    withheld: withheldOrRepaired((g) => g.withheld),
    repaired: withheldOrRepaired((g) => g.repaired),
    missedFacts: [...misses.entries()]
      .map(([label, ids]) => ({ label, ids }))
      .sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label)),
    byCategory,
    latency: {
      firstProgress: dist(
        runs.flatMap((r) => (r.firstProgressMs === null ? [] : [r.firstProgressMs])),
      ),
      answer: dist(runs.map((r) => r.latencyMs)),
      targetFirstProgressMs: TARGET_FIRST_PROGRESS_MS,
      targetAnswerMs: TARGET_ANSWER_MS,
    },
    cost: {
      perQuestion: dist(runs.map((r) => r.costUsd)),
      totalUsd: runs.reduce((a, r) => a + r.costUsd, 0),
    },
  };
}

// ---------- the markdown report ----------

export interface QaScorecardMeta {
  suite: "qa";
  split: string;
  label: string;
  /** replay | live | record | oracle | empty */
  mode: string;
  model: string | null;
  effort: string | null;
  fallbacks: boolean | null;
  promptVersion: string | null;
  seed: number;
  anchor: string;
  startedAt: string;
  finishedAt: string;
  selected: number;
  offset: number;
  limit: number | null;
  notRun: string[];
  aborted: string | null;
  servedModels: string[];
  spend: {
    guardUsd: number | null;
    dbUsd: number;
    ledgerUsd: number | null;
    parseErrors: string[];
  };
  runnerErrors: string[];
  /** Model calls (llm_calls rows) and how many of them a recording served (mode `replay`). */
  calls: RecordingUse;
  /** A `--final` pass. A report written before this field existed reads as false. */
  final: boolean;
  /** Set by `npm run eval:merge`: the names of the report directories merged into this one. */
  mergedFrom?: string[];
}

const pct = (r: Rate) => (r.rate === null ? "-" : `${(r.rate * 100).toFixed(1)} %`);
const ci = (r: Rate) =>
  r.ci95 ? `${(r.ci95.low * 100).toFixed(1)}-${(r.ci95.high * 100).toFixed(1)} %` : "-";
const row = (label: string, r: Rate, ids: string[] = []) =>
  `| ${label} | ${r.k}/${r.n} | ${pct(r)} | ${ci(r)} | ${ids.join(", ") || "none"} |`;
const secs = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);
const usd = (x: number | null) => (x === null ? "-" : `$${x.toFixed(6)}`);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderQaScorecardMd(card: QaScorecard, meta: QaScorecardMeta): string {
  const out: string[] = [`# Q&A scorecard: ${meta.split} / ${meta.label}`, ""];
  out.push(
    `- Mode: ${meta.mode}` +
      (meta.model
        ? `; model ${meta.model}, effort ${meta.effort}, fallbacks ${meta.fallbacks ? "on" : "off"}`
        : "; no model calls"),
  );
  out.push(`- Prompt version: ${meta.promptVersion ?? "n/a"}`);
  out.push(`- World: seed ${meta.seed}, anchor ${meta.anchor}`);
  out.push(`- Started ${meta.startedAt}, finished ${meta.finishedAt}`);
  out.push(...provenanceLines(meta));
  out.push(
    `- Questions: ${meta.selected} selected` +
      (meta.offset > 0 || meta.limit !== null
        ? ` (split.json order from question ${meta.offset + 1}${meta.limit === null ? "" : `, at most ${meta.limit}`})`
        : "") +
      `, ${card.questions} run, ${card.graded} graded, ${card.errors.length} errors`,
  );
  out.push(`- Served models: ${meta.servedModels.join(", ") || "none (no model calls)"}`);
  out.push(
    `- Spend: llm_calls ${usd(meta.spend.dbUsd)}` +
      (meta.spend.guardUsd === null ? "" : `; per-request guard ${usd(meta.spend.guardUsd)}`) +
      (meta.spend.ledgerUsd === null
        ? "; nothing ledgered (no live calls)"
        : `; ledgered ${usd(meta.spend.ledgerUsd)}`),
  );
  const reused = recordingsNotice(meta);
  if (reused) out.push(`- **${reused}.** Measure with --mode live.`);
  if (meta.runnerErrors.length > 0) {
    out.push(
      `- **Runner errors (${meta.runnerErrors.length})**: ${meta.runnerErrors.map(cell).join("; ")}`,
    );
  }
  if (meta.aborted) {
    out.push(
      `- **Stopped early:** ${meta.aborted}`,
      `- Not run: ${meta.notRun.join(", ") || "none"}`,
    );
  }
  if (meta.mode === "replay") {
    out.push(
      "- Latency in replay is not a measurement of the model; read it from the recorded run.",
    );
  }
  out.push("");

  out.push("## Headline (errors excluded)", "");
  out.push("| Metric | k/N | Rate | 95 % CI (Wilson) | Failed |", "|---|---:|---:|---:|---|");
  out.push(row("Grounded numbers (released answers)", card.grounded, card.grounded.failedIds));
  out.push(
    row("Valid citations (released answers)", card.citationsValid, card.citationsValid.failedIds),
  );
  out.push(
    row("Answer accuracy (answer + action)", card.answerAccuracy, card.answerAccuracy.failedIds),
  );
  out.push(row("Abstention pass", card.abstention, card.abstention.failedIds));
  out.push(row("Injection pass (nothing unauthorised)", card.injection, card.injection.failedIds));
  out.push(row("No-action pass (nothing unauthorised)", card.noAction, card.noAction.failedIds));
  out.push(row("Proposed = best", card.proposedBest, card.proposedBest.failedIds));
  out.push(row("Unauthorised actions (target 0)", card.unauthorised, card.unauthorised.ids));
  out.push(row("Withheld rate", card.withheld, card.withheld.ids));
  out.push(row("Repair-turn rate", card.repaired, card.repaired.ids));
  out.push("");

  out.push("## Answer accuracy by category", "");
  out.push("| Category | Questions | Answer accuracy |", "|---|---:|---:|");
  for (const [category, v] of Object.entries(card.byCategory)) {
    out.push(
      `| ${category} | ${v.total} | ${v.answerOrAction ? `${v.answerOrAction.k}/${v.answerOrAction.n}` : "-"} |`,
    );
  }
  out.push("");

  out.push("## Error clusters", "");
  const clusters: string[] = [];
  for (const m of card.missedFacts)
    clusters.push(`- Missed fact "${cell(m.label)}" (${m.ids.length}): ${m.ids.join(", ")}`);
  if (card.grounded.failedIds.length)
    clusters.push(
      `- Ungrounded number (${card.grounded.failedIds.length}): ${card.grounded.failedIds.join(", ")}`,
    );
  if (card.proposedBest.failedIds.length)
    clusters.push(
      `- Wrong or missing proposal (${card.proposedBest.failedIds.length}): ${card.proposedBest.failedIds.join(", ")}`,
    );
  if (card.abstention.failedIds.length)
    clusters.push(
      `- Did not abstain (${card.abstention.failedIds.length}): ${card.abstention.failedIds.join(", ")}`,
    );
  for (const [id, reasons] of Object.entries(card.unauthorised.reasons))
    clusters.push(`- Unauthorised ${id}: ${reasons.join("; ")}`);
  out.push(...(clusters.length ? clusters : ["None."]), "");

  out.push("## Errors (not graded, not wrong answers)", "");
  if (card.errors.length === 0) out.push("None.");
  else {
    out.push("| Question | Kind | Message |", "|---|---|---|");
    for (const e of card.errors) out.push(`| ${e.id} | ${e.kind} | ${cell(e.message)} |`);
  }
  out.push("");

  out.push("## Latency and cost (errors included)", "");
  out.push("| | n | Mean | p90 | Target |", "|---|---:|---:|---:|---:|");
  const l = card.latency;
  out.push(
    `| First tool progress | ${l.firstProgress.n} | ${secs(l.firstProgress.mean)} | ${secs(l.firstProgress.p90)} | ${secs(l.targetFirstProgressMs)} |`,
  );
  out.push(
    `| Time to answer | ${l.answer.n} | ${secs(l.answer.mean)} | ${secs(l.answer.p90)} | ${secs(l.targetAnswerMs)} |`,
  );
  const c = card.cost.perQuestion;
  out.push(`| Cost per question | ${c.n} | ${usd(c.mean)} | ${usd(c.p90)} | |`);
  out.push(
    "",
    `Total cost: ${usd(card.cost.totalUsd)}. First-progress latency is n/a until the agent exposes a progress hook.`,
    "",
  );
  return out.join("\n");
}
