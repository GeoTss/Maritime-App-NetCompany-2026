import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SUPPLIERS } from "@pharos/db";
import { CRITICAL_FIELDS, ExtractionOutput, ExtractionTruth } from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sourceText } from "../../apps/api/src/ai/extract.js";
import { evaluateExtraction } from "../../apps/api/src/ingest/evaluate.js";
import { parseEmail } from "../../apps/api/src/ingest/parse-email.js";
import { GENERATED_BAND, upcomingServedPorts } from "./facts.js";
import { diffGolden, GENERATED, type RenderedCase, renderGoldenFiles } from "./generate.js";
import { REVIEW_GENERATED_SAMPLE, reviewSample } from "./review.js";
import { GOLDEN_DIR } from "./split.js";
import { EVAL_ANCHOR, eurUsd, evalWorld, marketPriceUsd, openRequirementOf } from "./world.js";

const ROOT = resolve(import.meta.dirname, "../..");
const world = evalWorld();
const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY_MS;

let files: Map<string, string>;
let cases: RenderedCase[];
const onDisk = new Map<string, string>();

beforeAll(async () => {
  ({ files, cases } = await renderGoldenFiles(world));
  for (const name of await readdir(GOLDEN_DIR)) {
    onDisk.set(name, await readFile(join(GOLDEN_DIR, name), "utf8"));
  }
}, 60_000);

const truths = () =>
  [...onDisk.entries()]
    .filter(([n]) => n.endsWith(".truth.json"))
    .map(([n, text]) => ({ file: n, truth: ExtractionTruth.parse(JSON.parse(text)) }));

describe("golden extraction set: files", () => {
  it("is byte-stable: a second render is identical and matches the files on disk", async () => {
    const again = await renderGoldenFiles(world);
    expect([...again.files.entries()]).toEqual([...files.entries()]);
    expect(await diffGolden(files, GOLDEN_DIR)).toEqual([]);
    expect(files.size).toBe(240 * 3 + 2);
  });

  it("npm run eval:golden -- --check passes on the committed set", () => {
    const out = execFileSync("npx", ["tsx", "evals/extraction/generate.ts", "--check"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out).toContain("golden set OK: 722 files match (240 cases)");
  }, 60_000);

  describe("diffGolden on a changed copy (what makes --check exit 1)", () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "golden-check-"));
      await cp(GOLDEN_DIR, dir, { recursive: true });
    });
    afterAll(async () => rm(dir, { recursive: true, force: true }));

    it("reports a changed, a missing and a stale file", async () => {
      const truth = join(dir, "plain-001.truth.json");
      await writeFile(truth, (await readFile(truth, "utf8")).replace('"USD"', '"EUR"'));
      await rm(join(dir, "pdf-002.eml"));
      await writeFile(join(dir, "plain-999.oracle.json"), "{}\n");
      expect(await diffGolden(files, dir)).toEqual([
        "differs: plain-001.truth.json",
        "missing: pdf-002.eml",
        "stale: plain-999.oracle.json",
      ]);
    });
  });

  it("every truth parses ExtractionTruth and is named after its id", () => {
    const all = truths();
    expect(all).toHaveLength(240);
    for (const { file, truth } of all) expect(file).toBe(`${truth.id}.truth.json`);
  });

  it("has the planned categories: 200 generated + 20 hard + 20 trap variants, ~20 % not a quote", () => {
    const count = (tag: string) => cases.filter((c) => c.truth.tags[0] === tag).length;
    expect(GENERATED.map((g) => [g.prefix, g.count])).toEqual([
      ["plain", 40],
      ["html", 30],
      ["pdf", 30],
      ["eur", 25],
      ["multi-grade", 20],
      ["forwarded", 15],
      ["not-a-quote", 40],
    ]);
    expect(
      ["plain", "html", "pdf", "eur", "multi_grade", "forwarded", "not_a_quote", "hard"].map(count),
    ).toEqual([40, 30, 30, 25, 20, 15, 40, 40]);
    expect(cases.filter((c) => c.truth.tags.includes("variant:v2"))).toHaveLength(20);
    const kinds = cases
      .filter((c) => c.truth.tags[0] === "not_a_quote")
      .map((c) => c.truth.tags[1]);
    for (const k of ["invoice", "delivery_note", "port_notice", "rfq"]) {
      expect(kinds.filter((x) => x === `kind:${k}`)).toHaveLength(7);
    }
    for (const k of ["out_of_office", "newsletter"]) {
      expect(kinds.filter((x) => x === `kind:${k}`)).toHaveLength(6);
    }
    const share = cases.filter((c) => c.truth.expected.kind === "not_a_quote").length / 240;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
  });
});

describe("golden extraction set: oracles", () => {
  it("every oracle parses ExtractionOutput and its evidence is verbatim in the parsed email", async () => {
    let evidenceCount = 0;
    for (const c of cases) {
      const oracle = ExtractionOutput.parse(
        JSON.parse(onDisk.get(`${c.truth.id}.oracle.json`) ?? "null"),
      );
      const parsed = await parseEmail(
        new TextEncoder().encode(onDisk.get(`${c.truth.id}.eml`) ?? ""),
      );
      const source = sourceText(parsed);
      const evidence: (string | null)[] =
        oracle.kind === "not_a_quote"
          ? [oracle.evidence]
          : oracle.kind === "security_quote"
            ? [oracle.providerName.evidence, oracle.dayRate.evidence]
            : [
                oracle.supplierName.evidence,
                oracle.vesselName.evidence,
                oracle.vesselImo.evidence,
                oracle.port.evidence,
                oracle.deliveryFrom.evidence,
                oracle.deliveryTo.evidence,
                oracle.validUntil.evidence,
                oracle.bargeFee.evidence,
                ...oracle.lines.flatMap((l) => [
                  l.grade.evidence,
                  l.quantity.evidence,
                  l.price.evidence,
                ]),
              ];
      for (const e of evidence) {
        if (e === null) continue;
        evidenceCount++;
        expect(source.includes(e), `${c.truth.id}: "${e}"`).toBe(true);
        expect(e.includes("\n"), `${c.truth.id}: one line`).toBe(false);
      }
    }
    expect(evidenceCount).toBeGreaterThan(1500);
  });

  it("every oracle, through the pipeline's checks, gives the truth status, check and values", () => {
    const keyOf = (id: number | null) =>
      SUPPLIERS.find((s) => s.name === world.suppliers.find((x) => x.id === id)?.name)?.key ?? null;
    for (const c of cases) {
      if (!c.receivedAt) throw new Error(`${c.truth.id} has no Date header`);
      const ev = evaluateExtraction(world, c.doc, c.oracle, {
        receivedAt: c.receivedAt,
        hasUnreadableAttachment: c.hasUnreadableAttachment,
      });
      const e = c.truth.expected;
      const failed = ev.checks.filter((x) => !x.passed).map((x) => x.check);
      expect(ev.status, `${c.truth.id} status (failed: ${failed.join(", ")})`).toBe(e.status);
      if (e.status === "needs_review") {
        expect(
          e.reviewChecks.some((r) => failed.includes(r)),
          `${c.truth.id}: one of ${e.reviewChecks.join(", ")} fails (failed: ${failed.join(", ")})`,
        ).toBe(true);
      }
      if (e.quote === null) continue;
      const n = ev.normalised;
      expect(
        {
          vesselImo: world.vessels.find((v) => v.id === n.vesselId)?.imo ?? null,
          portUnlocode: world.ports.find((p) => p.id === n.portId)?.unlocode ?? null,
          supplierKey: keyOf(n.supplierId),
          currency: n.currency,
          validUntil: n.validUntil,
          deliveryFrom: n.deliveryFrom,
          deliveryTo: n.deliveryTo,
          bargeFee: n.bargeFee,
          lines: n.lines,
        },
        c.truth.id,
      ).toEqual(e.quote);
    }
  });

  it("only the image-only hard case and its variant have an unreadable attachment", () => {
    expect(cases.filter((c) => c.hasUnreadableAttachment).map((c) => c.truth.id)).toEqual([
      "hard-pdf-image-only",
      "hard-pdf-image-only-v2",
    ]);
  });
});

describe("golden extraction set: truth against the world", () => {
  it("every truth IMO, UN/LOCODE and supplier key exists in the eval world", () => {
    for (const { truth } of truths()) {
      const q = truth.expected.quote;
      if (!q) continue;
      if (q.vesselImo !== null) expect(world.vessels.map((v) => v.imo)).toContain(q.vesselImo);
      if (q.portUnlocode !== null) {
        expect(world.ports.map((p) => p.unlocode)).toContain(q.portUnlocode);
      }
      if (q.supplierKey !== null) expect(SUPPLIERS.map((s) => s.key)).toContain(q.supplierKey);
    }
  });

  it("generated quotes follow the generation rules and state every critical field (R21)", () => {
    const generated = cases.filter(
      (c) => c.truth.source === "generated" && c.truth.expected.kind === "quote",
    );
    expect(generated).toHaveLength(160);
    for (const c of generated) {
      const id = c.truth.id;
      const e = c.truth.expected;
      const q = e.quote;
      if (!q || !c.receivedAt) throw new Error(`${id} has no quote or no Date header`);
      expect(e.status, id).toBe("extracted");
      // R21: no null critical field in a generated quote.
      expect(Object.values(q).includes(null), id).toBe(false);
      for (const l of q.lines) expect(Object.values(l).includes(null), id).toBe(false);
      expect(CRITICAL_FIELDS).toHaveLength(9);

      const vessel = world.vessels.find((v) => v.imo === q.vesselImo);
      const port = world.ports.find((p) => p.unlocode === q.portUnlocode);
      const supplier = SUPPLIERS.find((s) => s.key === q.supplierKey);
      if (!vessel || !port || !supplier) throw new Error(`${id}: unknown entity`);
      const req = openRequirementOf(world, vessel.id);
      expect(supplier.ports, `${id}: supplier serves port`).toContain(port.unlocode);
      expect(upcomingServedPorts(world, req.voyageId), `${id}: upcoming call`).toContain(port.id);
      expect(
        q.lines.map((l) => l.grade),
        `${id}: required grade`,
      ).toContain(req.grade);
      expect(new Set(q.lines.map((l) => l.grade)).size).toBe(q.lines.length);
      for (const l of q.lines) {
        if (!l.grade || l.qtyMt === null || l.pricePerMt === null) throw new Error(id);
        expect(l.qtyMt, `${id}: qty fits the tank`).toBeLessThanOrEqual(
          vessel.tankCapacityMt[l.grade],
        );
        const usd = l.pricePerMt * (q.currency === "EUR" ? eurUsd(world) : 1);
        const market = marketPriceUsd(world, port.id, l.grade);
        expect(Math.abs(usd / market - 1), `${id}: price band`).toBeLessThanOrEqual(GENERATED_BAND);
      }
      const ageH = (EVAL_ANCHOR.getTime() - c.receivedAt.getTime()) / 3_600_000;
      expect(ageH, `${id}: received near the anchor`).toBeGreaterThanOrEqual(1);
      expect(ageH).toBeLessThanOrEqual(44);
      const received = c.receivedAt.toISOString().slice(0, 10);
      const valid = q.validUntil as string;
      const from = q.deliveryFrom as string;
      const to = q.deliveryTo as string;
      expect(daysBetween(received, valid), `${id}: validity after receipt`).toBeGreaterThan(0);
      expect(daysBetween(received, valid)).toBeLessThanOrEqual(60);
      expect(daysBetween(valid, from), `${id}: delivery after validity`).toBeGreaterThan(0);
      expect(daysBetween(from, to), `${id}: a real span`).toBeGreaterThan(0);
      expect(daysBetween(received, to)).toBeLessThanOrEqual(120);
      expect(q.bargeFee).toBeGreaterThanOrEqual(0);
    }
    const currencies = new Set(generated.map((c) => c.truth.expected.quote?.currency));
    expect([...currencies].sort()).toEqual(["EUR", "USD"]);
  });

  it("generated forwarded cases come from the supplier's own domain, newest offer on top", () => {
    for (const c of cases.filter((x) => x.truth.tags[0] === "forwarded")) {
      const q = c.truth.expected.quote;
      const supplier = SUPPLIERS.find((s) => s.key === q?.supplierKey);
      expect(c.doc.sender?.endsWith(`@${supplier?.emailDomain}`), c.truth.id).toBe(true);
      const oracle = c.oracle;
      if (oracle.kind !== "quote") throw new Error("expected a quote oracle");
      const body = c.doc.bodyText;
      const quoted = body.search(
        /^(?:-----Original Message-----|-{10} Forwarded message|On .* wrote:)/m,
      );
      expect(quoted, c.truth.id).toBeGreaterThan(0);
      // Price and validity evidence sit above the quoted older offer.
      for (const e of [oracle.lines[0]?.price.evidence, oracle.validUntil.evidence]) {
        expect(body.indexOf(e ?? "\u0000"), c.truth.id).toBeLessThan(quoted);
        expect(body.indexOf(e ?? "\u0000")).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("golden extraction set: hygiene", () => {
  it("leak check: no golden email line of 40+ characters appears in the extraction prompt", async () => {
    const prompt = await readFile(join(ROOT, "apps/api/src/ai/prompts/extract-quote.ts"), "utf8");
    const leaks: string[] = [];
    for (const c of cases) {
      const lines = [
        ...sourceText(c.doc).split("\n"),
        ...(onDisk.get(`${c.truth.id}.eml`) ?? "").split("\r\n"),
      ];
      for (const raw of lines) {
        const line = raw.trim();
        if (line.length >= 40 && prompt.includes(line)) leaks.push(`${c.truth.id}: ${line}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("leak check: no hard case's quantity, price or barge span appears in the prompt", async () => {
    const prompt = (
      await readFile(join(ROOT, "apps/api/src/ai/prompts/extract-quote.ts"), "utf8")
    ).toLowerCase();
    const spans: string[] = [];
    for (const c of cases.filter((x) => x.truth.source === "hard")) {
      if (c.oracle.kind !== "quote") continue;
      for (const f of [
        c.oracle.bargeFee,
        ...c.oracle.lines.flatMap((l) => [l.quantity, l.price]),
      ]) {
        if (f.asWritten !== null) spans.push(`${c.truth.id}: ${f.asWritten}`);
      }
    }
    expect(spans.length).toBeGreaterThan(40);
    const leaks = spans.filter((s) => prompt.includes((s.split(": ")[1] ?? "").toLowerCase()));
    expect(leaks).toEqual([]);
  });

  it("REVIEW.md shows the 20 new variants first, then the 20 hard and 15 generated cases", () => {
    const review = onDisk.get("REVIEW.md") ?? "";
    const sample = reviewSample(cases.map((c) => c.truth));
    expect(sample).toHaveLength(REVIEW_GENERATED_SAMPLE);
    const strata = new Set(sample.map((id) => cases.find((c) => c.truth.id === id)?.truth.tags[0]));
    expect(strata.size).toBe(7);
    const headings = [...review.matchAll(/^### (\S+) \(/gm)].map((m) => m[1]);
    const isVariant = (c: RenderedCase) => c.truth.tags.includes("variant:v2");
    expect(headings).toEqual([
      ...cases.filter(isVariant).map((c) => c.truth.id),
      ...cases.filter((c) => c.truth.source === "hard" && !isVariant(c)).map((c) => c.truth.id),
      ...sample,
    ]);
    expect(review.indexOf("## New dev trap variants — please review")).toBeLessThan(
      review.indexOf("## What to check for each case"),
    );
    expect(review).toContain("dev-only trap variants");
    expect(review).toContain("How corrections are applied");
    expect(review).toContain("never edited by hand");
  });
});
