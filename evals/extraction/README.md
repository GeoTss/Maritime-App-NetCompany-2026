# Extraction benchmark: runner, graders, scorecard

Every golden email of a split goes through the app's own entry points, `ingestRaw` and then
`processDocument` (awaited), on a clean eval database. The result is graded against the
hand-checked truth (`evals/golden/extraction/<id>.truth.json`, generated from code, never from a
model) and summed into a scorecard. No model judges anything.

| File           | What                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `run.ts`       | CLI and runner: database, extractors, spend controls, reports         |
| `grade.ts`     | `gradeCase(truth, outcome, keys)`: per-field verdicts and case flags   |
| `scorecard.ts` | `scorecard(runs)`: k/N with 95 % Wilson intervals; `scorecard.md`      |

## Commands

```bash
# Free and deterministic: serves fixtures/llm-recordings, fails on a miss
npm run eval -- --suite extraction --split dev --mode replay

# Baselines: no model, no key, no network (run before any paid pass)
npm run eval -- --suite extraction --split dev --oracle    # truth through the graders: about 100 %
npm run eval -- --suite extraction --split dev --empty     # an all-null quote: about 0 %

# Paid (Haiku 5.5). The gate pass is record WITHOUT --repeat-hard: same requests as live, and it
# writes the recordings, so a later --mode replay reproduces the scorecard for free.
npm run eval -- --suite extraction --split dev --mode record --label <name>

# Paid, for run-to-run variance only: each hard case run twice (the first run is the headline).
# On the 84-case dev split (26 hard) that is 110 case runs, a $0.11 estimate, inside one pass.
npm run eval -- --suite extraction --split dev --mode live --repeat-hard 2 --label <name>

# Paid, a split too big for one $0.25 pass: consecutive chunks, each its own pass and ledger row
npm run eval -- --suite extraction --split dev --mode record --offset 0 --limit 60 --label <name>-1
npm run eval -- --suite extraction --split dev --mode record --offset 60 --limit 60 --label <name>-2

# The final held-out pass: once, in Phase 7, live. 156 cases, each of the 14 hard ones 3 times:
# 184 case runs, a $0.184 estimate, one pass.
npm run eval -- --suite extraction --split heldout --final --mode live --repeat-hard 3 --label <name>

# Merge the reports of one pass that stopped early (any mode, as long as every report shares it)
npm run eval:merge -- --suite extraction --label <name> <report dir> <report dir>
```

Options: `--label x` (letters, digits, `.`, `_`, `-`; default: the mode, or `oracle` / `empty`),
`--offset n` (skip the first n cases of the split in `split.json` order; default 0),
`--limit n` (at most n cases after the offset), `--split dev|heldout`
(default dev), `--mode` (default replay).

The runner refuses:

- `--split heldout` without `--final`. The held-out split runs once, in Phase 7.
- `--final` with `--mode record`: the final pass is a live measurement, and record mode is
  replay-first (Ruling 25).
- `--repeat-hard` with `--mode record`, because record mode is replay-first: every repeat would be
  served the hard case's existing recording, so the repeats would measure nothing. Use
  `--mode live` to measure variance.
- `--oracle` or `--empty` with `--mode live|record` (they make no calls), both together, unknown
  flags, and a second run on the same database while one is running (advisory lock).
- A live or record pass whose estimate (case runs × $0.001, repeats included; Phase 3 measured
  $0.00073 per email) is over the $0.25 per-pass cap, before any call. Run the split in
  consecutive chunks with `--offset` and `--limit` instead; each chunk is checked against the cap
  and ledgered on its own. `--repeat-hard 7` on the 84-case dev split is 240 case runs ($0.24);
  `--repeat-hard 8` is 266 ($0.266) and is refused. An `--offset` that leaves no case is refused
  too.
- A final live held-out pass (`--split heldout --final --mode live`) that selects a case already
  listed in `evals/heldout-passes.jsonl`, or that has an empty label, before any call, ledger row
  or report.

**Held-out runs once (Ruling R8).** A final live held-out pass appends one row to the tracked
`evals/heldout-passes.jsonl` for each `rows.jsonl` row it writes, errors included:
`{suite, id, run, at, label, report, outcome}`, with `outcome` `graded` or `error:<kind>`. The pass
row is written first, so a case is consumed before it has a row: if that write fails, the run stops
(a runner fault) before the case's `rows.jsonl` line. Oracle, empty and replay passes never touch
the file. If a pass stops early (spend cap, interrupt, a runner fault), its report keeps its rows
and a scorecard listing what was not run; the cases with no row then run once, with `--offset`, and
`npm run eval:merge` joins the reports. A case that produced a row is never run again. Only the
CLI names the real file; tests pass temp paths. A finished pass writes its scorecard before the
last database cleanup, so a cleanup failure cannot leave it without one.

**Merging (`npm run eval:merge`).** Only the reports of one pass merge: they must share suite,
split, mode (any of live, record, replay, oracle, empty), model, effort, fallbacks, prompt version,
seed, anchor and `final` (a report without `final` reads as false); chunks may differ in
`--repeat-hard`; a case with a first run in two reports is refused. The rows are put in the
runner's order (first runs in `split.json` order, then the repeats), scored as one run's rows are,
and written as a new report with `meta.mergedFrom`. When the reports cover every selected case,
`aborted` is null and `notRun` empty. Two kinds of entry can stay in a merged `notRun`:

- **Missing first runs** (`<id>`): cases with no row in any report. These are what a resume must
  fill: run them once (`--offset`), then merge again.
- **Hard-case repeats that can no longer run** (`<id>#2`, `<id>#3`): a pass that stopped during
  its first runs never reached the repeats, and their case already has a run-1 row, so the passes
  file refuses it. They stay in `notRun` as a note (with the original `aborted` reason). The
  headline is complete without them; only the variance section has fewer runs. While anything is
  listed in `notRun`, `eval:merge` exits 1.

The exit code is 1 when the run stopped at the spend cap, failed (a non-Haiku model, an unreadable
response body, a runner error), or was a replay run with misses. After Ctrl-C (SIGINT), SIGTERM or
SIGHUP it is 130.

**Runner errors.** After each case the runner reads back what `processDocument` stored. An
`extracted` case must have exactly one stored quote, of its extraction, whose supplier, port,
currency, dates, barge fee and lines equal the normalised view that is graded; any other status
must have no quote. Each disagreement is listed in `meta.runnerErrors` and the scorecard, and
fails the run after the report is written.

## Modes and extractors

| Mode / flag | Extractor                          | Key | Network | Ledger |
| ----------- | ---------------------------------- | --- | ------- | ------ |
| `replay`    | Haiku 5.5 from the recordings      | no  | no      | no     |
| `live`      | Haiku 5.5                          | yes | yes     | yes    |
| `record`    | Haiku 5.5, writing each recording  | yes | yes     | yes    |
| `--oracle`  | returns `<id>.oracle.json`         | no  | no      | no     |
| `--empty`   | a quote with every field null and one all-null line | no | no | no |

The extractor config is fixed: `claude-haiku-5-5`, effort `medium`, fallbacks off. It does not
read `EXTRACT_MODEL`, so recordings always match. The key comes from `ANTHROPIC_API_KEY`, loaded by
`tsx --env-file-if-exists=.env`, and is never printed.

## Database hygiene

The runner uses `connectTestDb("eval_extraction")` (the vitest tests use other names). It seeds once
per run: seed 20261114, anchor 2026-11-14T08:00:00Z, plus `evalExtraRequirements`. It then checks
that the stored requirements are the eval world's. Before every case run it deletes only what cases
create: documents, extractions, quotes with an `extraction_id` and their lines, `llm_calls` and
audit rows. Then it checks that the row counts are back at the seeded baseline. Seed quotes and
purchase orders stay.

## Reports

`evals/reports/<UTC>-extraction-<split>-<label>/`. The directory is created before the first
call; if the name exists, `-2`, `-3`, ... is added, so a report is never overwritten. Each case's
lines are appended to `rows.jsonl` and `transcripts.jsonl` as it finishes, so a run that fails
or is stopped part way keeps what it paid for. The scorecard files are written at the end, or on an
interrupt or a runner fault for the rows so far (`meta.aborted` says why, `meta.notRun` what is
left). `meta.final` is true for a `--final` pass.

- `rows.jsonl`: one line per case run, with the pipeline status, kind, error and error kind,
  failed checks, normalised view, full grade, latency, every `llm_calls` row, and the served models.
- `transcripts.jsonl`: the document text, the stored extraction (raw output, evidence, check
  results, error), and every request and response. In live and record these come from the
  transport, retries included. In replay they come from the recordings.
- `scorecard.json`: `{ meta, scorecard }`. `scorecard.md`: the same as tables.

Recompute the headline from `rows.jsonl` if anything looks surprising.

## How a case is graded

The pipeline's normalised view (`normaliseExtraction` of the stored raw output; null when there
is no output) is mapped to the truth's codes: vessel id to IMO, port id to UN/LOCODE, and supplier
id to supplier key. Then each field is compared by type:

| Field                     | Equal when                   |
| ------------------------- | ---------------------------- |
| price, barge fee          | the same to the cent (\|a − b\| < 0.005) |
| quantity                  | exactly the same (mt)        |
| validUntil, delivery dates| the same ISO day             |
| vessel, port, supplier, currency | the same code         |

- **correct**: equal. Both null counts as equal.
- **missing**: the truth has a value and the pipeline has null.
- **wrong**: the pipeline's value differs, including any value where the truth is null. A
  resolved id the world cannot name is wrong, not missing.

**Line alignment.** Each truth line with a grade takes the first unpaired predicted line of the
same grade. The lines left on both sides are then paired in order, so a wrong grade costs one
field, not a whole line. A truth line left over has every field missing. A predicted line left over
(an extra line) is graded against null: each grade, quantity or price it holds is wrong, and each
null is correct.

Fields are graded only on truth-quote cases with a non-null `quote`. A not-a-quote answer, or no
output at all, leaves every truth field missing.

Two things to know when reading per-field numbers. The supplier is resolved from the sender's
domain by code, not from the model's output, so even `--empty` scores it. An empty barge field
means "included" (0), so `--empty` gets the barge fee wrong whenever a fee was quoted.

## Metrics

Each headline is k/N with a 95 % Wilson interval. It uses the **first run** of each case, and
**errors are excluded** from every denominator.

| Metric | k / N |
| --- | --- |
| Critical-field accuracy | correct / all critical-field instances over truth-quote cases. Instances: per line, price, quantity and grade; per quote, currency, port, vessel, validUntil, deliveryFrom and deliveryTo (`CRITICAL_FIELDS`) |
| Per-field accuracy | correct / instances of that field, with wrong and missing counts |
| Unsafe auto-accepts | cases stored as `extracted` while the truth is not a quote, or the truth status is not `extracted`, or any critical field, the barge fee or the supplier is wrong or missing / all graded cases. The barge fee and supplier count here (they decide what is paid and to whom) but not in critical-field accuracy (user decision 2026-11-14) |
| Quote precision / recall | predicted kind `quote` and truth `quote` / predicted `quote` (precision) or truth `quote` (recall). The predicted kind is `extractions.kind`; a failed case with no output counts as neither |
| Not-a-quote precision / recall | the same for `not_a_quote` |
| Review-queue rate | status `needs_review` or `failed` (what the review queue lists) / graded cases |
| False-review rate | truth `extracted`, status anything else / truth-`extracted` cases |
| Needs-review recall | truth `needs_review` and sent to review (status `needs_review` or `failed`, what the review queue lists) / truth-`needs_review` cases. `extracted` or `not_a_quote` is a miss, because no human sees it. N is small on dev (3 cases), so read the interval |
| Review check matched | truth `needs_review` and at least one of `truth.reviewChecks` failed / truth-`needs_review` cases |
| Latency per email | wall time of ingest + processing, mean and p90, against the ~20 s target. Model latency (sum of `llm_calls.latency_ms`) is shown beside it. In replay neither one measures the model |
| Cost per email | sum of `llm_calls.cost_usd`, priced from the API's usage, mean and p90. The total covers every run, repeats included |

**Errors are not wrong answers.** An API error, truncation, refusal or replay miss is recognised
by type when the extractor throws: `APIError` (HTTP or connection, including the spend guard's
refusal), the stop reason (`refusal` or `max_tokens`) of the `ExtractionError`'s last call, or
`ReplayMissError`. These cases are listed with their id and message and graded on nothing. Any
other failure (an unusable output, a pipeline fault) is graded as status `failed`, and its message
is listed under "Graded failures".

**Variance (`--repeat-hard N`).** Each hard case (`tags[0] = "hard"`) runs N times. Repeats are
not in the headline. For each case the variance section shows the status per run, whether the
kind and critical values agreed across runs (line order ignored; "unknown" if a run errored),
critical correctness per run, unsafe runs, and, for truth `needs_review` cases, runs sent
to review and runs where a review check matched. It also gives needs-review recall and review
check matched over every graded run of the repeated cases.

## Spend rules (per-phase budget, Haiku 5.5 only)

The cap is per phase: `evals/budget.json` names the current phase and its cap (set by the user;
Phase 3 was $3.00), and the phase's spend is the sum of its rows in `evals/spend-ledger.jsonl`
(`evals/lib/budget.ts`). Live and record only (replay, `--oracle` and `--empty` spend nothing and
write no ledger row):

1. Before the first call: `assertHaikuOnly([configured model])`; the estimate (case runs ×
   $0.002) must be at most the $0.25 per-pass cap; then `assertBudget(estimate)` against the
   ledger. The run refuses to start if the phase's ledger total plus the estimate would pass the
   phase cap.
2. During the run, a per-request guard is capped at min($0.25, phase cap − the phase's ledger
   total). Once it is over, the runner starts no further case. The report names the cases not run, and the exit
   code is 1. Overrun is bounded to one request. The guard also stops the run at the first
   response served by a model other than `claude-haiku-5-5`: it refuses the next request, the
   runner starts no further case (`aborted` names the model), and step 3 fails the run.
3. After the run: every served model (the response's `model` at the transport, or the recording's
   in replay) and every `llm_calls.model` must be `claude-haiku-5-5`. Otherwise the run fails, after
   the report is written.
4. Every response body the guard could not read is listed in `meta.spend.parseErrors` and fails
   the run, after the report is written, because its cost is not counted.
5. The guard's summed cost is appended to the ledger (`run: "eval-extraction"`, the label) exactly
   once. This happens on success, failure, a stop, or SIGINT / SIGTERM / SIGHUP. On a signal the
   handler ledgers synchronously, writes the scorecard for the rows so far (`aborted: "interrupted
   by SIGINT"`, the cases not run), and exits 130. A request still in flight then has no usage yet,
   so it is ledgered at the $0.001 per-case estimate.

A 64-case dev pass is about $0.03–0.10 on Haiku 5.5.
