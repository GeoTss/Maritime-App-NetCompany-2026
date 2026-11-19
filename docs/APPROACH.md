# Pharos: approach and results

Pharos is a hackathon prototype of a GenAI assistant for a ship operator's bunker-to-berth desk.
This page explains how it is built, what was measured and where the numbers stop. The full design
is [`MASTER_PLAN.md`](MASTER_PLAN.md); every evaluation pass, including the pre-registration of the
held-out pass, is logged in [`EVAL_LOG.md`](EVAL_LOG.md).

## What it does

The operator watches the fleet on a map of AIS traffic with a wave and wind overlay. One bulk
carrier, MV Aegean Pioneer (Port Said to Rotterdam), is flagged: its low-sulphur fuel will not cover
the remaining emission-control legs with the safety margin. Supplier quote emails arrive; Pharos
turns each into a structured quote that shows the sentence each value came from, or holds it for a
person when something is in doubt. The operator asks where to bunker and from whom, then which route
and speed make the berth window in this weather. The answers compare the options, and every number
links to its source; the cheapest headline price is not the best option once barge fee, deviation,
delay, weather and carbon cost are counted. Pharos then proposes a purchase order and a voyage
instruction. A person approves: the order goes to a local ERP simulator and comes back with a PO
number, and the messages are drafted, never sent. ([MASTER_PLAN §1](MASTER_PLAN.md#1-scenario-bunker-to-berth))

## The approach, and why

On a desk where one fuel order is a large sum, the failure that matters is a plausible number that
nobody computed. The design makes that failure checkable ([§3](MASTER_PLAN.md#3-deterministic-maths--a-hard-guarantee), [§6](MASTER_PLAN.md#6-runtime-ai-pipeline--one-workflow-one-agent-two-prompts)):

- **The model reads and explains; code computes.** Distances, ETAs, fuel, weather effect, costs,
  CO₂, ETS and FuelEU, congestion and rankings are computed in `packages/domain`, which is pure (no
  network, model SDK, hidden clock or randomness; a hook checks it). External services supply raw
  observations only. Arithmetic asked for in chat goes through a `calculate` tool over fact IDs.
- **Every number shown is a cited fact.** Tools return facts with IDs and provenance. A release gate
  shows an answer only if every number in it matches a tool fact at its displayed precision; an
  answer that fails gets one automatic repair turn and is otherwise withheld.
- **The model only proposes.** `propose_action` is the one write-capable tool. It creates a pending
  recommendation that references a stored calculation by ID, so no quantity or price typed by the
  model reaches an order. The executor acts only on a human approval; nothing is sent to an external
  party.
- **Doubt goes to a human, decided by code checks**, not by the model's confidence: evidence found
  in the source, entities resolved uniquely, dates readable, price within a band of the market
  index, validity not expired, quantity within tank capacity.
- **Email content is untrusted data**, passed to the model as delimited data. Both benchmarks
  include prompt-injection cases.
- **Live sources with recorded fallbacks.** AIS (AISStream) and weather (Open-Meteo) each have a
  live and a recorded mode, and the console shows which is in use. Model replies can be replayed, so
  the demo and the tests also run free and deterministic.
- **One model throughout:** Claude Haiku 5.5, for extraction and for the agent, in the app and in
  every evaluation.

## Headline numbers

Held-out first, dev beside it. **Held-out** ran once, live, on frozen code (`27a38c2`), after a
committed pre-registration (`fbbf596`). **Dev** is the split used for iteration and phase gates; its
column is the last full dev pass of each suite (extraction 15 Nov, Q&A 16 Nov), with the same prompt
versions and live model calls. Each value is k of N with its Wilson 95 % interval, copied from
[`evals/published/summary.json`](../evals/published/summary.json), the same entries the console's
Evaluation page shows. Latency and cost per item come from the same entries.

**Quote extraction** (Claude Haiku 5.5, prompt `extract-quote/v2`)

| Metric | Held-out, run once (156 emails) | Dev (84 emails) |
|---|---|---|
| Critical-field accuracy | 1170 of 1182 · 99.0 % (98.2–99.4 %) | 646 of 651 · 99.2 % (98.2–99.7 %) |
| Unsafe auto-accepts, per graded email (target 0) | 0 of 156 (0.0–2.4 %) | 0 of 84 (0.0–4.4 %) |
| Quote precision | 126 of 126 · 100.0 % (97.0–100.0 %) | 70 of 70 · 100.0 % (94.8–100.0 %) |
| Quote recall | 126 of 127 · 99.2 % (95.7–99.9 %) | 70 of 71 · 98.6 % (92.4–99.8 %) |
| Not-a-quote precision | 29 of 30 · 96.7 % (83.3–99.4 %) | 13 of 14 · 92.9 % (68.5–98.7 %) |
| Not-a-quote recall | 29 of 29 · 100.0 % (88.3–100.0 %) | 13 of 13 · 100.0 % (77.2–100.0 %) |
| Emails sent to review | 21 of 156 · 13.5 % (9.0–19.7 %) | 21 of 84 · 25.0 % (17.0–35.2 %) |
| Errors, truncations, refusals (target 0) | 0 of 156 (0.0–2.4 %) | 0 of 84 (0.0–4.4 %) |
| Latency per email, mean | 6.0 s | 5.5 s |
| Cost per email | $0.000704 | $0.000730 |

Critical fields are vessel, port, currency, validity, delivery dates, grade, quantity and price. An
**unsafe auto-accept** is a wrong critical value stored without review. It is counted per graded
email: the 156 include the 29 emails that are not quotes, so per stored quote the bound would be
somewhat wider. 0 of 156 supports "below 2.4 % at 95 % confidence", not "never". Of the 21 held-out
emails sent to review, 10 needed it (needs-review recall 10 of 10) and 11 did not (false reviews 11
of 117; [scorecard](../evals/reports/20261116T152129Z-extraction-heldout-p7-heldout/scorecard.md)).

**Question answering** (Claude Haiku 5.5, prompt `agent-system/v5`)

| Metric | Held-out, run once (32 questions) | Dev (33 questions) |
|---|---|---|
| Grounded answers (every number is a tool fact) | 32 of 32 · 100.0 % (89.3–100.0 %) | 33 of 33 · 100.0 % (89.6–100.0 %) |
| Answer accuracy | 23 of 24 · 95.8 % (79.8–99.3 %) | 25 of 25 · 100.0 % (86.7–100.0 %) |
| Abstains when it cannot know | 4 of 4 · 100.0 % (51.0–100.0 %) | 4 of 4 · 100.0 % (51.0–100.0 %) |
| Injection resisted | 2 of 2 · 100.0 % (34.2–100.0 %) | 3 of 3 · 100.0 % (43.9–100.0 %) |
| No action when none is needed | 2 of 2 · 100.0 % (34.2–100.0 %) | 2 of 2 · 100.0 % (34.2–100.0 %) |
| Proposed option is the best one | 2 of 2 · 100.0 % (34.2–100.0 %) | 5 of 5 · 100.0 % (56.6–100.0 %) |
| Unauthorised actions (target 0) | 0 of 32 (0.0–10.7 %) | 0 of 33 (0.0–10.4 %) |
| Answers repaired by the release gate | 5 of 32 · 15.6 % (6.9–31.8 %) | 2 of 33 · 6.1 % (1.7–19.6 %) |
| Errors, truncations, refusals (target 0) | 0 of 32 (0.0–10.7 %) | 0 of 33 (0.0–10.4 %) |
| First progress, mean | 1.1 s | 1.1 s |
| Answer, mean / 90th percentile | 3.8 s / 6.7 s | 4.5 s / 7.5 s |
| Cost per question | $0.000985 | $0.001119 |

Grounded is counted over released answers; no held-out answer was withheld (0 of 32), and 5 passed
the gate only on their repair turn. Answer accuracy covers the 24 held-out questions with an
expected answer; the abstention, injection and no-action cases are scored on their own rows. First
progress is timed for answers that called a tool (25 held-out, 28 dev).

**Live demo story.** One fully live run on the frozen code (live model, live AIS, live weather)
passed in 45.1 s for $0.009373: 8 agent and 3 extraction calls, Claude Haiku 5.5 only
([summary](../evals/reports/20261116T150714Z-story-live-p7/summary.json)). Against the
[§6](MASTER_PLAN.md#6-runtime-ai-pipeline--one-workflow-one-agent-two-prompts) targets: three
emails delivered and extracted in 5.620 s together (target 20 s per email); first progress 1.244 s,
1.821 s and 2.849 s for the bunker, route and instruction questions (target 3 s; the last is close
to it); full answers 7.164 s, 9.269 s and 7.258 s (target 45 s); "Plan route" to three candidate
routes on the map 0.262 s (target about 5 s of compute). The first paid attempt failed; see the
limits.

## How it was measured

- **Benchmark first.** Each golden set was built before the capability it measures was tuned.
  Extraction has 240 emails: generated through varied templates (plain text, HTML tables, PDFs,
  EUR, multi-grade, forwarded threads), 20 hard cases (ambiguous quantity, expired validity,
  image-only PDF, spoofed supplier, injected instructions and others), 20 dev-only variants of the
  hard traps, and non-quotes. Q&A has 65 questions: lookups, comparisons, calculations, bunker and
  route decisions, congestion, compliance, questions it must abstain on, injection and no-action
  cases.
- **Truth by code, never by a model.** Generated emails are rendered from their truth records;
  hard-case truth is written by hand in code; Q&A expected answers are computed by reference code
  (the domain functions the tools use) over the seeded world and the recorded fixtures. The truth
  was reviewed before paid runs (review sheets in `evals/golden/`) and is edit-protected by a hook.
  Graders are programmatic and grade outcomes, not tool sequences; no model judges anything.
- **Baselines.** Truth fed through the graders must score about 100 % and an empty extractor about
  0 % before any paid pass. On the held-out split: oracle 1182 of 1182 critical fields and 24 of 24
  answers; empty 5 of 1182 and 0 of 24.
- **Random stratified split** (seed 20261114, by category, in hash order): extraction dev 84 /
  held-out 156; Q&A dev 33 / held-out 32. Changes were tuned on dev only, under a logged protocol
  (hypothesis written before the run; one Phase 6 tool-description change was logged late, and the
  log says so).
- **Held-out once, pre-registered.** The commands, metrics, grader limits, abort and runner-error
  policy and four hypotheses were committed before any held-out call. Each suite then ran once,
  live. The guard file `evals/heldout-passes.jsonl` lists every held-out case run (216 rows:
  extraction 156 + 14 + 14, Q&A 32; every case and run number once), and the runner refuses a listed case. Nothing was
  changed in response to the results. The two passes cost $0.162785.
- **Errors apart.** API errors, truncations and refusals are listed separately and never counted as
  wrong answers. Neither held-out pass had any.
- **Run-to-run variance.** The 14 held-out hard cases ran three times each (outside the headline).
  Statuses were identical across runs in 13 of 14 (hard-eur-quote-in-band went to review once, then
  extracted twice); critical values agreed in 11 of 14; 0 unsafe runs in 42; every repeated run of a
  case that needs review went to review (30 of 30, 88.6–100.0 %).
- **Pre-registered hypotheses.** H21, extraction critical-field accuracy inside or above the dev
  interval: holds (99.0 %, inside 98.2–99.7 %). H22, 0 unsafe auto-accepts of 156: holds. H23,
  grounded 100 % of released answers and 0 unauthorised of 32: holds. H24, at most two answer misses,
  with the risk in route-speed-04, route-speed-07 and compliance-03: holds with one miss, but the miss
  was route-speed-11, which the hypothesis did not name.

## Honest limits

**The measurement**

- **Two grader limits, parked before the run** (Phase 7 plan, R6). For comparison questions the
  grader checks the two cited values but not the verdict word, so an answer that names the wrong
  side as larger would still pass (held-out comparison-02, -04, -05, -08 and congestion-03). For a
  date and time, the grader matches the date and the time independently, so a right date and a
  right time attached to different events could pass (route-speed-04, -07). They were not tightened
  because no dev answer exercised either path, so a stricter rule could not be tested first. As
  pre-registered, the 7 held-out answers they touch were read by hand after the run: each names the
  correct side, and each instant is labelled correctly. The limits hid no wrong answer in this run;
  no grade was changed.
- **Small Q&A set, wide intervals.** Answer accuracy 23 of 24 has an interval of 79.8–99.3 %; rows
  with 2 questions (injection, no-action, proposed = best) have a lower bound of 34.2 %. They show
  the behaviour holds on unseen questions; they do not pin a rate.
- **"0 of N" is a bound, not "never".** 0 unsafe auto-accepts in 156 emails bounds that rate below
  2.4 %; 0 unauthorised actions in 32 questions bounds it below 10.7 %.
- **The one Q&A miss**, route-speed-11 ("Is there a reported hazard on Thessaly Star's route, and
  which route avoids it?"). The answer names route B as the recommended route that avoids the hazard,
  but identifies the hazard by its description ("a drifting container … SYNTHETIC TEST HAZARD")
  rather than its id `synthetic:1`, which the truth requires, and it also says routes A and C do not
  cross it. Graded a miss; not tuned.
- **Extraction misses are missing dates, never wrong values.** All 12 held-out critical-field misses
  are delivery dates that came back empty (10 delivery-from, 2 delivery-to); 0 critical values were
  wrong. Each of those emails failed the date check and went to review, so a person supplies the
  date. They are most of the 11 false reviews.

**The data and models**

- **Danger areas are planning boxes from secondary reports** (Track 3). Levels, policies and
  limits come from the sources listed in `docs/research/2026-11-19-maritime-security-sources.md`
  (JMIC levels as reported by Palaemon Maritime on 9 Nov 2026, the JWC listed areas of 16 Sep 2026,
  ICC/IMB piracy figures), each area with its date. The boxes approximate the published limits;
  team day rates, the war-risk premium rate and hull values are illustrative. Security quote
  extraction is measured on dev only (dev pass of 19 Nov, `extract-quote/v4`: critical fields
  234/243, unsafe auto-accepts 0/30; the one miss was a false review, since fixed in code). The 30
  held-out security cases have not been run, and the held-out Q&A security questions are not run
  either.

- **Synthetic private data.** The fleet, its fuel and load, suppliers, prices, quotes and the golden
  emails are synthetic. Real: public AIS ships and their positions, weather, ports and sea routes.
  Extraction accuracy is measured on synthetic emails, not real supplier mail.
- **Recorded fixtures of 15 Nov kept** (R1). The AIS capture (15 Nov, about 22:55 UTC) and the
  weather snapshot were kept for the final measurement. Recorded mode rebases them to the clock
  pinned at 14 Nov 2026 08:00 UTC and so pins the world; a refresh would move 17 of the 65 Q&A
  truths and every route replay. The published Q&A score describes the fixtures that ship, not
  today's sea.
- **Planning-grade, not navigation-grade.** Routes follow the Eurostat maritime network;
  emission-control-area boundaries are planning-grade boxes; the weather effect is a simplified
  parametric model (speed loss and extra consumption by waves, wind and current), not a validated
  hydrodynamic one.
- **Congestion is illustrative.** Waiting time per ship at anchor is an illustrative parameter, not
  a measured queue time.
- **FuelEU is shown as an exposure**: the penalty the fuel would attract if nothing offsets it.
  Pooling, banking, borrowing, the yearly average and the repeat-deficit multiplier are ignored.
- **Load figures are synthetic.** Fleet displacement uses synthetic lightship, cargo and ballast
  values. A real ship's load is read from its AIS draught against a reference profile; a missing
  draught counts as laden, the cautious side.
- **No real hazard.** Three 600 s AIS captures carried no safety, aid-to-navigation or
  search-and-rescue message, so the demo's hazard is synthetic and labelled so on the map.

**The live demo**

- **Multi-turn caveats.** Earlier turns' tool results are not carried into later turns, so in a live
  multi-turn conversation a later answer can add a caveat disowning figures from an earlier one
  ("Please treat those figures as unverified until I re-run the bunker plan", in the live run's
  `story-6-evaluation.png`). Seen in the live story run; not changed, because the agent code was
  frozen for the measurement.
- **The first live story attempt failed** at step 4 ($0.006576). In live AIS mode the fleet's
  simulated vessels also appear as AIS traffic; clicking the flagged vessel's marker selected its
  AIS twin, which left "Plan route" disabled. Recorded mode has no twin, so every free run had
  passed. The console was fixed in `27a38c2`, the frozen code, before the held-out passes (the fix
  touched no measured path), and the second attempt passed.
- **Nordwind price retype.** The demo's Nordwind email writes its price "EUR 690 / mt", with a
  space before the slash, and the normaliser does not accept that unit form, so the price is not
  taken from the email. The email goes to review anyway (its quantity "300/350 mt" is ambiguous), and the reviewer
  types the price as well as the quantity. The fix was parked (R9) because it would have changed
  measured code on measurement day.

## What would come next

- Carry a conversation's facts into later turns, so a follow-up cites earlier figures instead of
  disowning them.
- Grade the comparison verdict and the date-and-time pairing, prove the stricter graders on dev,
  then measure on a fresh held-out set (this one has run and is closed).
- More held-out questions per category, to narrow the Q&A intervals.
- Capture delivery dates more reliably (the only critical-field miss) and accept "/ mt" with a
  space, both measured on dev first.
- Real, anonymised supplier emails in the extraction set, and the deferred real mailbox (IMAP).
- Refresh the AIS capture and weather snapshot with regenerated, reviewed truths; keep listening for
  a real hazard message.
- Beyond the prototype: a validated weather model, FuelEU pooling and banking, a real ERP.
