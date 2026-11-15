# Eval log

Results log for the Pharos benchmarks (extraction and Q&A). Procedure: the `eval-bench` project
skill (`.claude/skills/eval-bench/SKILL.md`); strategy: `docs/MASTER_PLAN.md` §7.

Prompt-change protocol (every entry follows it):

1. One hypothesis per change, written here **before** the run that tests it.
2. Bump `PROMPT_VERSION` with the change.
3. Iterate on the **dev** split only. The held-out split runs once, in Phase 7 (`--final`).
4. Keep a change only if dev improves beyond run-to-run noise without regressions in critical
   fields.
5. Log the date, the change, the dev score before → after and the cost. Live spend is also
   ledgered in `evals/spend-ledger.jsonl`.

Errors (API, truncation, refusal, replay miss) are reported separately and never counted as wrong
answers. Ground truth is never written by a model and never edited to make a score pass.

---

## 2026-11-14 — `extract-quote/v2` (Phase 3 Task 7)

**Change** (`apps/api/src/ai/prompts/extract-quote.ts`, v1 → v2). Three edits, one hypothesis each.
The untrusted-data paragraph is unchanged.

- **H1 — attachment sections.** v1 said attachments "may be absent" and that the body is
  authoritative. Since Task 5 the document text carries each readable attachment after a
  `--- attachment: <name> ---` line. v2 says those sections are part of the document and as
  authoritative as the body (evidence may be copied from them), and that a mentioned attachment
  with no section must never be guessed. *Expected:* PDF-attachment cases transcribe their
  values from the section with evidence that passes `evidence_found`, rather than coming back
  null or not_a_quote. An image-only PDF still ends `needs_review` (the code check
  `attachment_text_found`), with no values invented for it.
- **H2 — newest offer in a thread.** v2 adds: in a reply or forwarded chain, transcribe only the
  supplier's most recent offer, and never a value from an older quoted offer, not even for a
  field the newest offer leaves out. *Expected:* stale-revision thread cases store the newest
  values or go to review. A stale value is never stored, so these cases add no unsafe
  auto-accepts.
- **H3 — dates as written.** v1 said the date's `asWritten` is the text "exactly as written". v2
  adds: times included, no reformatting, no year added. *Expected:* fewer date `asWritten` spans
  that are missing from the evidence or carry an invented year, so the date checks in
  `packages/domain` work on the supplier's own text.

**Dev score before → after:** not measured yet. The golden set (Task 9) and runner (Task 10) do
not exist yet, so there is no v1 dev baseline. The first dev pass is Task 11, which measures v2.

**Checks for this change** (demo regression only, not accuracy):

- Demo extraction replays re-recorded with v2 (Haiku 5.5, effort medium, `LLM_FALLBACKS=off`):
  **$0.001216**, 2 calls, both `end_turn`, both `kind=quote`. Kestrel: USD 738 per mt, 300 mt
  LSMGO, barge USD 2,800 lump sum, Marsaxlokk. Strait Line: USD 712 PMT, 300 MT LSMGO, barge
  USD 9,000 lump sum, Gibraltar. Dates null, notes null. The "PDF attached" mention with no
  attachment section added nothing. The full replay suite passes on the new recordings, the
  agent replays included (no agent re-record).
- Live smoke `phase3-prompt-v2` (Haiku 5.5, report
  `evals/reports/20261114T185117Z-smoke-phase3-prompt-v2`): **PASS, $0.003776**, 6 calls
  (2 extract $0.001295, 4 agent $0.002481). email-1 `extracted` in 3.1 s and email-2
  `extracted` in 5.0 s, each with 0 failed checks and its demo quote (Kestrel USD 738/mt 300 mt
  barge 2,800; Strait Line USD 712/mt 300 mt barge 9,000). Ask 10.6 s, approve OK.
- Phase 3 ledger after this change: $0.0050 of $3.00 spent ($2.9950 left).

**Decision:** keep v2 pending the Task 11 dev pass. The demo regression is clean. H1–H3 are not
yet tested against a golden set.

## 2026-11-15 — First live dev pass (extract-quote/v2) and code-only resolution fixes

**Run 1:** `--mode record`, Claude Haiku 5.5, effort medium, 84 dev cases (64 approved + 20 dev-only trap
variants). Report `evals/reports/20261115T032117Z-extraction-dev-dev-haiku-v2-gate`. Cost **$0.062191**.
- Critical-field accuracy 616/651 (94.6 %, CI 92.6–96.1 %); unsafe auto-accepts **0/84**.
- Every miss was a *missing* value, never a wrong one. 28 were the port; 5 delivery ends; 1 vessel; 1 price.
- False-review rate 27/55. Needs-review recall 16/16.

**Error analysis** (transcripts read for 10 failing cases). The model transcribed ports exactly as written
("Antwerp outer anchorage", "Rotterdam (NLRTM)", "Hamburg anchorage"), which the exact-match resolver
rejected. The delivery misses were a copied label ("Delivery Nov 15-17") and a digit-free remark
("14-15 Nov (on arrival)"); one price had its unit written "USD/MT".

**Hypothesis H4 (code, not prompt):** these are resolution/normalisation gaps, so fixing them in code
raises critical-field accuracy on the *same* model outputs with no new unsafe accepts.
- `resolvePort`: the one known port named (as whole words) inside the span; two ports stay ambiguous.
- `parseDeliveryWindow`: drop a copied field label and a trailing remark that holds no digits.
- `normalisePerUnit`: accept a currency written in front of the unit ("USD/MT").

**Result (replay of run 1, free):** 644/651 after the port fix, **649/651 (99.7 %)** after all three,
unsafe 0/84; oracle baseline still 651/651. Remaining 2 misses are model slips that go to review
(vessel omitted on a compact line; "19" split from "19-20 Nov"). **Decision:** keep. Prompt unchanged.

## 2026-11-15 — `agent-system/v2` (Phase 4 Task 4)

**Change:** the agent gains `list_fleet`, `list_quotes`, `get_emissions` and `calculate` (seven
tools); `plan_bunkering` plans each open requirement (one plan per grade, still-valid quotes only).
The prompt gets a one-line-per-tool list, the rule "use calculate for any arithmetic and cite the
fact it returns" in place of "say you do not have it", and `propose_action` per plan whose best
option is feasible, citing only that plan's facts.

**Hypothesis H1 (agent):** with `calculate` available and named in the rules, a question that needs
a difference, sum, ratio or percentage gets a cited derived fact (`f_calc:<id>:value`) instead of an
abstention or a model-computed number, without changing the demo bunker answer (Kestrel at
Marsaxlokk proposed, every number cited, gate passing on the first attempt). Measured by the
Phase 4 Q&A benchmark (`calculate` category, Tasks 7–9); here only the demo regression is checked.

**Checks for this change** (demo regression only, not accuracy):

- Demo ask re-recorded with v2 (Haiku 5.5, effort medium, `LLM_FALLBACKS=off`): **$0.001713**,
  3 calls (`plan_bunkering` → `propose_action` → answer, `end_turn`). Gate passed on attempt 1;
  one pending `MTMLA-kestrel` recommendation; every number cited (total $233,914, headline
  $712/mt vs $738/mt, saving $16,172). The three v1 agent recordings were removed (unreachable).
- Live smoke `phase4-agent-v2` (Haiku 5.5, report
  `evals/reports/20261115T170125Z-smoke-phase4-agent-v2`): **PASS, $0.003443**, 5 calls
  (2 extract $0.001534, 3 agent $0.001909). email-1 5.1 s, email-2 5.0 s, ask 7.3 s, approve OK.
- Phase 4 ledger after this change: $0.0052 of $1.00.

**Decision:** keep v2 pending the Q&A dev pass (Task 9). H1 is not yet tested against a golden set.

## 2026-11-15 — Phase 4 Q&A dev pass 1, `agent-system/v2` (Task 9)

**Run:** `dev-haiku-v1` (Haiku 5.5, effort medium, record, 23 dev questions), report
`evals/reports/20261115T174910Z-qa-dev-dev-haiku-v1`. Oracle `dev-oracle` 16/16, 23/23, 0 spend;
live **$0.024372** (Phase 4 total $0.0295 of $1.00). Grounded 22/22, injection 2/2, no-action 2/2,
unauthorised 0/23, proposed=best 4/4. Answer accuracy 10/16, abstention 2/3, withheld 1/23.

**Hypotheses (one per change; none applied yet, they are proposals for the controller):**

- **H2 (grader, evals/qa/grade.ts):** the 4 bunker_decision misses (decision-01/02/05/06) have the
  right supplier, port and recommendation (proposed=best 4/4) but fail only because the required
  fact "Best option" has the string value `MTMLA-kestrel` and the answer never writes or cites that
  id. If `statesValue`/`factMatches` accept an option's supplier and port names (from the option's
  own facts) as stating the best option, those 4 become correct with no change to the agent.
  Risk: it loosens a grader after seeing a result, so it needs the user's ruling.
- **H3 (prompt or repair text, `agent-system`):** comparison-06 was withheld because the model put
  both citations at the end of the sentence; the gate checks the first citation after each number
  (1,400 sits before `[f35]`, which holds 1,900). The repair message says "followed in the same
  sentence by its fact id" but not "immediately, one id per number". Adding that rule (and an
  example with two numbers in one sentence) to the repair message should lift withheld to 0 and
  repair rate (11/23 repaired) down.
- **H4 (prompt, time scope):** abstain-05 ("last year") got the current quote with a caveat. A rule
  "if the question names a period or date the facts do not carry, say you do not have it and give
  no numbers" should turn it into a correct abstention.
- **H5 (tool or label, comparison-03):** the question names no vessel; `plan_bunkering` requires a
  vessel and the model asked a clarifying question instead of calling it. Either `plan_bunkering`
  with no vessel plans every open requirement, or the question is reworded to name Aegean Pioneer
  (user's call; truth untouched).

## 2026-11-15 — `agent-system/v3` and the outcome grader (Phase 4 fix wave)

**Changes (agent, prompt `agent-system/v3`):** `propose_action` only when the operator asks for a
decision (where or from whom to buy, which offer, a recommendation, an order), never on a lookup,
comparison, calculation or "do not order yet" (prompt and tool description; v2 proposed after every
feasible plan); one fact id immediately after each number (prompt and the repair message); a "no
fact covers the period, subject or person: say so, write no numbers" rule; `plan_bunkering` takes an
optional vessel (none = every vessel's open requirements; today only Aegean Pioneer's).

**Hypotheses (one per change, tested by Q&A dev pass 2, run by the eval engineer after this wave):**

- **H6 (C1, propose only when asked to decide):** questions whose truth says `mustNotPropose`
  (lookups, comparisons, calculations) get no pending recommendation even when they call
  `plan_bunkering` (comparison-03), so unauthorised stays 0/23, while decision-01/02/05/06 and the
  demo ask still propose `MTMLA-kestrel` (proposed=best 4/4).
- **H3 (citation placement, prompt + repair message):** comparison-06 is released (1,900 and 1,400
  each cited right after the number), and the repair rate falls from 11/23.
- **H4 (no fact covers the question):** abstain-05 ("last year") abstains with no numbers; abstain
  stays 3/3 or better.
- **H5 (`plan_bunkering` with no vessel):** comparison-03 calls `plan_bunkering` without a vessel
  and states both total delivered costs, cited.

**Grader change (Ruling 16; not an agent hypothesis, truth files untouched):** `evals/qa/grade.ts`
now grades outcomes (MASTER_PLAN §7 B): a number is a cited ledger fact in the truth's unit within
tolerance whose value the answer states as the release gate reads it (displayed precision); labels
only pick between equal values; a string is in the ledger and written as a whole word; the
best-option id is satisfied by proposing it (or, where no proposal is allowed, by naming its
supplier and citing one of its facts). Re-grading the iteration-1 transcripts
(`20261115T174910Z-qa-dev-dev-haiku-v1`, $0, no model) with the new grader: answer accuracy
**10/16 → 14/16** (decision-01/02/05/06 become correct: right supplier, right numbers, right
proposal; comparison-03 and comparison-06 stay wrong). Both scorecards are to be reported; the
iteration-2 accuracy must be read against 14/16, not 10/16.

**Checks for this change** (demo regression and the gate's live smoke; accuracy is dev pass 2):

- Demo ask re-recorded with v3 (Haiku 5.5, effort medium, `LLM_FALLBACKS=off`): **$0.002991**,
  4 calls (`plan_bunkering` → `propose_action` + `calculate` → answer → repair answer). One
  pending `MTMLA-kestrel` recommendation (the demo question asks for a decision, so H6 keeps it);
  gate failed attempt 1 on one number ("pending recommendation 1", uncited) and passed on the
  repair turn (v2 passed on attempt 1). Recordings: 4 v3 demo-ask recordings added, the 3 v2 ones
  removed (unreachable, unreferenced).
- Live smoke `phase4-agent-v3` (report `evals/reports/20261115T182833Z-smoke-phase4-agent-v3`), now
  over `POST /api/ask/stream` and reading the drafts: **PASS, $0.003687**, 6 calls (2 extract
  $0.001253, 4 agent $0.002434). email-1 3.1 s, email-2 5.1 s, ask 9.8 s (target 45 s); 6
  progress events then 1 answer event; approve gave a PO; 2 drafts, both `draft`
  (`master_instruction`, `supplier_confirmation`).
- Oracle `fixwave-oracle` (new grader): accuracy 16/16, grounded 23/23, abstention 3/3,
  injection 2/2, no-action 2/2, proposed=best 4/4, unauthorised 0/23. Empty `fixwave-empty`: 0/16,
  abstention 0/3, proposed=best 0/4.
- Fix-wave live spend $0.006678; Phase 4 ledger $0.0362 of $1.00.

**Decision:** keep v3 pending dev pass 2. Watch the repair rate: both live demo asks needed one
repair turn (the smoke's second answer call shows it; in the recording the cause was an uncited
recommendation id). If dev pass 2 shows the same, a candidate next change is "do not write the
recommendation id; the approval card shows it".

### Q&A dev pass 2 results, `agent-system/v3` (Task 9 iteration 2)

Run `dev-haiku-v3` (Haiku 5.5, record, report `evals/reports/20261115T183408Z-qa-dev-dev-haiku-v3`):
accuracy **15/16**, grounded 23/23, abstention 3/3, injection 2/2, no-action 2/2, proposed=best 4/4,
unauthorised 0/23, withheld 0/23, repaired 9/23; **$0.023629** (Phase 4 total $0.0598 of $1.00).
Dev oracle 16/16 under the new grader; replay `dev-haiku-v3-replay` reproduces every section.
Iteration 1 re-graded under the new grader: 14/16 (before the prompt change: 14/16 -> 15/16).

- **H6 confirmed:** only decision-01/02/05/06 left a recommendation; unauthorised 0/23; proposed=best 4/4.
- **H3 confirmed:** comparison-06 released and correct; withheld 1 -> 0; repair rate 11/23 -> 9/23 (still high: calculate-04/05, comparison-01/03, decision-02, injection-02, lookup-01/09/10 repair once).
- **H4 confirmed:** abstain-05 abstains; abstention 3/3.
- **H5 confirmed:** comparison-03 calls `plan_bunkering` without a vessel and is correct.
- Remaining miss: calculate-03 (the model computed percent_change but cited a redundant divide ratio fact instead of the percent fact). No more fix iterations in Phase 4; carried to Phase 5.
