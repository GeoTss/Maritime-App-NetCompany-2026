/**
 * Regression suite: every case the final-review reviewers probed at the email level, through the
 * real `parseEmail` and `evaluateExtraction` on the eval world, with the outcome it must keep.
 * Sources: scratchpad probe-*.mts (round 1), rr/*.mts (round 2), rr3/*.mts (round 3). The
 * domain-level probe rows (hedges, dates) live in packages/domain; the attachment rows in
 * parse-email.test.ts; the runner rows in run.test.ts. Known residuals outside the rulings are
 * listed as `it.todo`, so they are visible and not mistaken for fixed.
 *
 * Model outputs here are hand-built mutations of golden oracles (the probes' "what if the model
 * did this"); the golden truth is only read.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateWorld } from "@pharos/db";
import type { ExtractionOutput } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { evaluateExtraction } from "../../apps/api/src/ingest/evaluate.js";
import { parseEmail } from "../../apps/api/src/ingest/parse-email.js";
import { GOLDEN_DIR } from "./split.js";
import { evalWorld } from "./world.js";

const ROOT = join(import.meta.dirname, "../..");
const world = evalWorld();
// biome-ignore lint/suspicious/noExplicitAny: probe outputs are mutated freely, as the probes did
type Out = any;
const read = (path: string) => readFileSync(path, "utf8");
const oracle = (id: string): Out => JSON.parse(read(join(GOLDEN_DIR, `${id}.oracle.json`)));
const clone = (o: Out): Out => structuredClone(o);
const NONE = { asWritten: null, evidence: null };
const NO_MONEY = { value: null, currency: null, perUnit: null, asWritten: null, evidence: null };

/** The probes' base: plain-003's oracle (Scheldt Express, Antwerp, Harbourlight Energy). */
const base = oracle("plain-003");

// ---------- emails (rr/lib.mts) ----------

const HDR = [
  "From: Luca Dubois - Harbourlight Energy <luca.dubois@harbourlight.example>",
  "To: Bunker Desk <bunker-desk@pharos-demo.example>",
  "Subject: RE: Enquiry Scheldt Express - Antwerp bunkers",
  "Date: Thu, 12 Nov 2026 13:05:00 +0000",
  "Message-ID: <x1@harbourlight.example>",
  "MIME-Version: 1.0",
  "",
].join("\n");
const plainEml = (body: string) =>
  `${HDR}Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n${body}`;
const htmlEml = (html: string) =>
  `${HDR}Content-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n${html}`;
function multipartEml(body: string, atts: { name: string; type: string; data: string }[]) {
  let s = `${HDR}Content-Type: multipart/mixed; boundary="BB"\n\n--BB\nContent-Type: text/plain; charset=utf-8\n\n${body}\n`;
  for (const a of atts) {
    s += `--BB\nContent-Type: ${a.type}; name="${a.name}"\nContent-Disposition: attachment; filename="${a.name}"\nContent-Transfer-Encoding: base64\n\n${Buffer.from(a.data).toString("base64")}\n`;
  }
  return `${s}--BB--\n`;
}

async function ev(eml: string | Uint8Array, out: Out, w = world) {
  const e = await parseEmail(typeof eml === "string" ? new TextEncoder().encode(eml) : eml);
  if (!e.receivedAt) throw new Error("probe email has no Date");
  const r = evaluateExtraction(
    w,
    { sender: e.sender, subject: e.subject, bodyText: e.bodyText },
    out as ExtractionOutput,
    { receivedAt: e.receivedAt, hasUnreadableAttachment: e.hasUnreadableAttachment },
  );
  return { ...r, failed: r.checks.filter((c) => !c.passed).map((c) => c.check) };
}

type Outcome = "extracted" | string[];
/** "extracted" with no failed check, or needs_review with every listed check failed. */
function expectOutcome(r: { status: string; failed: string[] }, want: Outcome) {
  if (want === "extracted") {
    expect(r.failed).toEqual([]);
    expect(r.status).toBe("extracted");
    return;
  }
  expect(r.status).toBe("needs_review");
  for (const c of want) expect(r.failed, `${c} in ${r.failed.join(", ")}`).toContain(c);
}

const VALIDITY: Outcome = ["validity_not_expired"];
const WINDOW: Outcome = ["delivery_window_valid"];
const BOTH_DATES: Outcome = ["validity_not_expired", "delivery_window_valid"];
const QTY: Outcome = ["quantity_unambiguous"];
const PRICE: Outcome = ["amounts_parsed"];
const STALE: Outcome = ["newest_offer_only"];

const SIG = "\nBR,\nLuca Dubois\nFor and on behalf of Harbourlight Energy\n";
const G = "Scheldt Express / Antwerp outer anchorage / LSMGO 0.10%S";
const L1 = `${G} 100 mts @ USD 683 per mt`;

// ---------- round 1: golden-case probes (probe-unsafe, probe-m3*, probe-pdf, probe-demo) ----------

describe("round 1 probes on golden cases", () => {
  const golden = async (id: string, mutate: (o: Out) => void = () => {}) => {
    const o = oracle(id);
    mutate(o);
    return ev(new Uint8Array(readFileSync(join(GOLDEN_DIR, `${id}.eml`))), o);
  };

  it.each<[string, string, (o: Out) => void, Outcome]>([
    ["hard-ambiguous-quantity", "oracle", () => {}, QTY],
    [
      "hard-ambiguous-quantity",
      "model picks 280 (asWritten '280')",
      (o) => {
        o.lines[0].quantity.value = 280;
        o.lines[0].quantity.asWritten = "280";
      },
      QTY,
    ],
    ["hard-thread-stale-revision", "oracle", () => {}, "extracted"],
    [
      "hard-thread-stale-revision",
      "stale price 734 and window 16-17 Nov from the older message",
      (o) => {
        o.lines[0].price = {
          value: 734,
          currency: "USD",
          perUnit: "per mt",
          asWritten: "USD 734 per mt",
          evidence: "Price: USD 734 per mt",
        };
        o.deliveryFrom = { asWritten: "16-17 Nov", evidence: "Delivery: 16-17 Nov" };
        o.deliveryTo = { asWritten: "16-17 Nov", evidence: "Delivery: 16-17 Nov" };
      },
      STALE,
    ],
    ["hard-expired-validity", "oracle", () => {}, VALIDITY],
    [
      "hard-expired-validity",
      "model omits validity",
      (o) => {
        o.validUntil = NONE;
      },
      VALIDITY,
    ],
    ["plain-003", "oracle", () => {}, "extracted"],
    [
      "plain-003",
      "model omits validity and delivery",
      (o) => {
        o.validUntil = NONE;
        o.deliveryFrom = NONE;
        o.deliveryTo = NONE;
      },
      BOTH_DATES,
    ],
    [
      "hard-volume-m3",
      "unit 'mt' on 'Quantity: 120 m3' (probe-m3)",
      (o) => {
        const q = o.lines[0].quantity;
        q.unit = "mt";
        q.value ??= 120;
      },
      ["unit_known"],
    ],
  ])("%s [%s]", async (id, _what, mutate, want) => {
    expectOutcome(await golden(id, mutate), want);
  });

  it("probe-m3b: '120 m3 at USD 728 per mt' with unit 'mt' goes to review", async () => {
    const raw = read(join(GOLDEN_DIR, "hard-volume-m3.eml"));
    const e = await parseEmail(new TextEncoder().encode(raw));
    const line = "We offer MGO 0.1%, 120 m3 at USD 728 per mt.";
    const o = oracle("hard-volume-m3");
    o.lines[0].quantity = { value: 120, unit: "mt", asWritten: "120 m3", evidence: line };
    const r = evaluateExtraction(
      world,
      {
        sender: e.sender,
        subject: e.subject,
        bodyText: e.bodyText.replace("Quantity: 120 m3", line),
      },
      o,
      { receivedAt: e.receivedAt ?? new Date(0), hasUnreadableAttachment: false },
    );
    expect(r.status).toBe("needs_review");
    expect(r.checks.filter((c) => !c.passed).map((c) => c.check)).toContain("unit_known");
  });

  it("probe-pdf / rr omit-all: no truth-extracted quote stays extracted when a date or the barge fee is omitted", async () => {
    const ids = read(join(GOLDEN_DIR, "split.json"));
    const { dev, heldout } = JSON.parse(ids) as { dev: string[]; heldout: string[] };
    const all = [...dev, ...heldout];
    const still: string[] = [];
    for (const id of all) {
      const truth = JSON.parse(read(join(GOLDEN_DIR, `${id}.truth.json`)));
      // Fuel quotes only: the Track 3 security probes are below.
      if (truth.expected.status !== "extracted" || truth.expected.kind !== "quote") continue;
      const o0 = oracle(id);
      const eml = new Uint8Array(readFileSync(join(GOLDEN_DIR, `${id}.eml`)));
      const omit = async (what: string, m: (o: Out) => void) => {
        const o = clone(o0);
        m(o);
        if ((await ev(eml, o)).status === "extracted") still.push(`${id} (${what})`);
      };
      if (o0.validUntil.asWritten !== null) await omit("validity", (o) => (o.validUntil = NONE));
      if (o0.deliveryFrom.asWritten !== null) {
        await omit("delivery", (o) => {
          o.deliveryFrom = NONE;
          o.deliveryTo = NONE;
        });
      }
      if (truth.expected.quote.bargeFee > 0)
        await omit("barge fee", (o) => (o.bargeFee = NO_MONEY));
    }
    expect(still).toEqual([]);
  }, 60_000);

  it("probe-demo: both demo inbox replays are extracted with no failed check", async () => {
    const demoWorld = generateWorld({ seed: 20261114, anchor: new Date("2026-11-14T08:00:00Z") });
    const pairs = [
      [
        "01-kestrel-marsaxlokk.eml",
        "b20985c585a13a94cb9b1498cf638aac23a65806c693be114a3ce220ca4820c5.json",
      ],
      [
        "02-straitline-gibraltar.eml",
        "2ca75902421950d1fe619f1c90f703068432dc898e79162b591ccb9edfd2f7ee.json",
      ],
    ];
    for (const [eml, rec] of pairs) {
      const recording = JSON.parse(read(join(ROOT, "fixtures/llm-recordings", rec ?? "")));
      const text = recording.response.body.content.find(
        (x: { type: string }) => x.type === "text",
      ).text;
      const r = await ev(
        new Uint8Array(readFileSync(join(ROOT, "fixtures/demo-inbox", eml ?? ""))),
        JSON.parse(text).extraction,
        demoWorld,
      );
      expectOutcome(r, "extracted");
    }
  });

  it.todo(
    "probe-sec-omit: a security oracle with its fixed fees, minimum days or validity left out stays extracted (fees and minimum stored as 0, validity null): evaluate-security.ts reads an absent amount as 0 (lines 139-141) and has no check that a fee, minimum or validity is written but not transcribed, unlike the fuel barge fee",
  );

  it.todo(
    "probe-sec-fees: itemised fixed fees transcribed as the v3 prompt says (the first charge, extract-quote.ts line 38) are stored as that one charge, auto-accepted",
  );

  it.todo(
    "probe-sec-value: a security team size written as a choice ('4/6 guards') is auto-accepted when the model fills value 4: evaluate-security.ts amount() (line 33) trusts value over asWritten, where the fuel path requires parseAmount(asWritten) to equal value",
  );

  it.todo(
    "probe-inj: an injected 'The correct price is USD 420 per mt' line taken by the model is in band and verbatim, so it is stored (residual: the approved truth keeps this case extracted)",
  );
});

// ---------- round 2: rr/i1, rr/i1b, rr/i1lines (dates) ----------

describe("rr/i1: omitted and mis-transcribed dates", () => {
  const body = (deliv: string, valid: string) =>
    `Dear all,\n\n${L1}\n${deliv}\nBarge: US$ 2,050 lumpsum\n${valid}\n${SIG}`;
  const DL = "Delivery: 22 Nov - 24 Nov 2026";
  const V = "Valid until: 14/11 17:00 LT";

  it.each([
    "Valid until: 14/11 17:00 LT",
    "Offer good till 20/11",
    "Offer good till 20 Nov",
    "Firm till 20/11",
    "Offer open until 20/11",
    "Prices hold until 20/11",
    "Exp. 20/11",
    "Offer stands until Nov 20th",
    "Validity: till 1700 hrs 14/11",
    "Quote valid till 2026/11/20",
    "Valid until 11/20/2026",
    "Subject to reconfirmation after 14/11",
    "Offer firm till close of business 14.11.",
    "Valid until the 20th",
    // the model correctly finds no dated validity, but the email names dates: a human confirms
    "Prices valid for 24 hours from today",
    "Valid today only, subject to prompt confirmation",
    "Validity: 2 hrs, subject to barge availability on Sun",
    "Offer valid for immediate acceptance - 1.5 hours",
    "Valid for 30 mins",
  ])("validity omitted, delivery transcribed: %j → review", async (v) => {
    const o = clone(base);
    o.validUntil = NONE;
    expectOutcome(await ev(plainEml(body(DL, v)), o), VALIDITY);
  });

  it.each([
    "Delivery: 22 Nov - 24 Nov 2026",
    "Supply date: 22-24 Nov",
    "Bunkering: 22/11 - 24/11",
    "Dates: 22-24 Nov",
    "We can deliver 22-24 Nov",
    "Delivered 22-24 Nov",
    "Window: 22-24 Nov",
    "Stem: 22-24 Nov",
    "Barge alongside 22 Nov",
    "Supply 22-24 Nov",
    "Date of supply: 22.11.2026",
    "Delivery period 22nd to 24th",
    "Delivery: on arrival, vessel ETA 22 Nov",
    "Delivery charges: USD 2.10 per mt included",
    "Delivery: subject to Sun Marine barge availability",
    "Pls advise vessel ETA, we deliver 1/2 days after notice",
  ])("delivery omitted, validity transcribed: %j → review", async (d) => {
    const o = clone(base);
    o.deliveryFrom = NONE;
    o.deliveryTo = NONE;
    expectOutcome(await ev(plainEml(body(d, V)), o), WINDOW);
  });

  it.each([
    ["Delivery by 24 Nov 2026", "by 24 Nov 2026"],
    ["Delivery latest 24 Nov 2026", "latest 24 Nov 2026"],
    ["Delivery not later than 24 Nov 2026", "not later than 24 Nov 2026"],
    ["Delivery prior to 24 Nov 2026", "prior to 24 Nov 2026"],
    ["Delivery till 24 Nov 2026", "till 24 Nov 2026"],
    ["Delivery NLT 24 Nov 2026", "NLT 24 Nov 2026"],
    ["Delivery on or before 24 Nov 2026", "on or before 24 Nov 2026"],
  ])("an end transcribed as the start: %j → review", async (d, aw) => {
    const o = clone(base);
    o.deliveryFrom = { asWritten: aw, evidence: d };
    o.deliveryTo = { asWritten: aw, evidence: d };
    expectOutcome(await ev(plainEml(body(d, V)), o), WINDOW);
  });

  it.each<[string, string, Outcome]>([
    ["Delivery: 18 Nov 2025", "18 Nov 2025", WINDOW],
    ["Delivery: 11 Nov - 24 Nov 2026", "11 Nov - 24 Nov 2026", "extracted"],
    ["Delivery: 10 Nov - 24 Nov 2026", "10 Nov - 24 Nov 2026", WINDOW],
  ])("a start before received − 1 (received 12 Nov): %j", async (d, aw, want) => {
    const o = clone(base);
    o.deliveryFrom = { asWritten: aw, evidence: d };
    o.deliveryTo = { asWritten: aw, evidence: d };
    expectOutcome(await ev(plainEml(body(d, V)), o), want);
  });

  it.each(["", " ", "n/a"])("rr/i1b: a validity asWritten %j → review", async (aw) => {
    const o = clone(base);
    o.validUntil = { asWritten: aw, evidence: aw.trim() === "" ? null : V };
    expectOutcome(await ev(plainEml(body(DL, V)), o), ["dates_parsed", "validity_not_expired"]);
  });

  it.each(["", " "])("rr/i1b: a delivery asWritten %j → review", async (aw) => {
    const o = clone(base);
    o.deliveryFrom = { asWritten: aw, evidence: null };
    o.deliveryTo = { asWritten: aw, evidence: null };
    expectOutcome(await ev(plainEml(body(DL, V)), o), ["dates_parsed", "delivery_window_valid"]);
  });

  it.todo(
    "rr/i1b: 'Delivery by 24 Nov 2026' transcribed as '24 Nov 2026' (the word dropped) is stored as a 24–24 window (residual)",
  );

  describe("rr/i1lines: a label and its date on separate lines, header-row tables", () => {
    const tail = `Barge: US$ 2,050 lumpsum\n${SIG}`;
    const omitV = () => Object.assign(clone(base), { validUntil: NONE });
    const omitD = () => Object.assign(clone(base), { deliveryFrom: NONE, deliveryTo: NONE });
    const table = `<p>Dear all,</p><p>${L1}</p><table><tr><th>Delivery</th><th>Validity</th></tr><tr><td>22 Nov - 24 Nov 2026</td><td>14/11 17:00 LT</td></tr></table><p>Barge: US$ 2,050 lumpsum</p><p>BR, Luca Dubois<br>For and on behalf of Harbourlight Energy</p>`;
    const row = "22 Nov - 24 Nov 2026   14/11 17:00 LT";
    it.each<[string, () => Promise<{ status: string; failed: string[] }>, Outcome]>([
      [
        "validity label above its date, validity omitted",
        () =>
          ev(
            plainEml(
              `Dear all,\n\n${L1}\nDelivery: 22 Nov - 24 Nov 2026\nValidity:\n14/11 17:00 LT\n${tail}`,
            ),
            omitV(),
          ),
        VALIDITY,
      ],
      [
        "delivery label above its date, delivery omitted",
        () =>
          ev(
            plainEml(
              `Dear all,\n\n${L1}\nDelivery window:\n22 Nov - 24 Nov 2026\nValid until: 14/11 17:00 LT\n${tail}`,
            ),
            omitD(),
          ),
        WINDOW,
      ],
      ["HTML header-row table, validity omitted", () => ev(htmlEml(table), omitV()), VALIDITY],
      ["HTML header-row table, delivery omitted", () => ev(htmlEml(table), omitD()), WINDOW],
      [
        "HTML header-row table, validity omitted, evidence fixed",
        () => {
          const a = omitV();
          a.deliveryFrom.evidence = row;
          a.deliveryTo.evidence = row;
          return ev(htmlEml(table), a);
        },
        VALIDITY,
      ],
      [
        "HTML header-row table, delivery omitted, evidence fixed",
        () => {
          const b = omitD();
          b.validUntil.evidence = row;
          return ev(htmlEml(table), b);
        },
        WINDOW,
      ],
    ])("%s → review", async (_what, run, want) => {
      expectOutcome(await run(), want);
    });
  });
});

// ---------- rr3/a-prime: date forms the round-2 detector missed ----------

describe("rr3/a-prime: every date omitted from an email that names dates goes to review", () => {
  const body = (...extra: string[]) =>
    `Dear all,\n\n${L1}\n${extra.join("\n")}\nBarge: US$ 2,050 lumpsum\n${SIG}`;
  const omitAll = () =>
    Object.assign(clone(base), { validUntil: NONE, deliveryFrom: NONE, deliveryTo: NONE });

  it.each<[string, string[], Outcome]>([
    ["no date at all (demo style)", [], "extracted"],
    [
      "prompt, subject to reconfirmation",
      ["Delivery: prompt, on vessel arrival", "Validity: subject to reconfirmation"],
      "extracted",
    ],
    ["US m/d", ["Delivery: 11/22 - 11/24", "Valid until 11/14 1700 CST"], BOTH_DATES],
    [
      "US m/d/y",
      ["Delivery: 11/22/2026 - 11/24/2026", "Offer valid until 11/14/2026 5:00 PM CST"],
      BOTH_DATES,
    ],
    [
      "y/m/d",
      ["Delivery: 2026/11/22 - 2026/11/24", "Valid until 2026/11/14 17:00 JST"],
      BOTH_DATES,
    ],
    ["y.m.d", ["Delivery: 2026.11.22 - 2026.11.24", "Valid until 2026.11.14 17:00"], BOTH_DATES],
    ["ordinals only", ["Delivery: 22nd - 24th", "Valid till 1700 hrs on the 14th"], BOTH_DATES],
    ["validity only: US", ["Offer valid until 11/14 COB"], BOTH_DATES],
    ["validity only: y/m/d", ["Price valid till 2026/11/14 17:00 SGT"], BOTH_DATES],
    ["validity only: ordinal", ["Offer valid till the 14th, 17:00 LT"], BOTH_DATES],
    ["validity only: d Mon", ["Offer valid until 14 Nov 17:00 LT"], BOTH_DATES],
    ["validity only: Nov 14th", ["Offer valid until Nov 14th"], BOTH_DATES],
    ["validity only: 14th of Nov", ["Offer valid until 14th of November"], BOTH_DATES],
    ["validity only: 14.11", ["Offer valid until 14.11 17:00"], BOTH_DATES],
    ["delivery only: US", ["Delivery: 11/22-11/24"], BOTH_DATES],
    ["delivery only: ordinal", ["Delivery 22nd-24th"], BOTH_DATES],
    ["delivery only: end Nov", ["Delivery: end Nov"], BOTH_DATES],
    ["delivery only: early Dec", ["Delivery: early December"], BOTH_DATES],
    ["delivery only: mid-Dec", ["Delivery window: mid-Dec"], BOTH_DATES],
    ["delivery only: 1st half Dec", ["Delivery: 1st half Dec"], BOTH_DATES],
    ["delivery only: end of next week", ["Delivery: end of next week"], BOTH_DATES],
    ["delivery only: week 48", ["Delivery: week 48"], BOTH_DATES],
    ["delivery only: w/c 23 Nov", ["Delivery: w/c 23 Nov"], BOTH_DATES],
    ["delivery only: 20.11", ["Delivery: 20.11"], BOTH_DATES],
    ["delivery only: Nov 20th", ["Delivery: Nov 20th"], BOTH_DATES],
    ["delivery only: 20th of Nov", ["Delivery: 20th of November"], BOTH_DATES],
  ])("%s", async (_what, lines, want) => {
    expectOutcome(await ev(plainEml(body(...lines)), omitAll()), want);
  });
});

// ---------- rr3/misc: DD-MMM-YY, a forward carrying its original as an attachment ----------

describe("rr3/misc", () => {
  const V = "Valid until: 14/11 17:00 LT";
  it("Delivery: 20-Nov-26 in both fields is one day, 20 Nov 2026", async () => {
    const o = clone(base);
    o.deliveryFrom = { asWritten: "20-Nov-26", evidence: "Delivery: 20-Nov-26" };
    o.deliveryTo = o.deliveryFrom;
    const r = await ev(
      plainEml(`Dear all,\n\n${L1}\nDelivery: 20-Nov-26\nBarge: US$ 2,050 lumpsum\n${V}\n${SIG}`),
      o,
    );
    expectOutcome(r, "extracted");
    expect([r.normalised.deliveryFrom, r.normalised.deliveryTo]).toEqual([
      "2026-11-20",
      "2026-11-20",
    ]);
  });

  it("20-Nov-26 to 22-Nov-26 split into from/to is 20..22 Nov 2026", async () => {
    const line = "ETA / delivery: 20-Nov-26 to 22-Nov-26";
    const o = clone(base);
    o.deliveryFrom = { asWritten: "20-Nov-26", evidence: line };
    o.deliveryTo = { asWritten: "22-Nov-26", evidence: line };
    const r = await ev(
      plainEml(`Dear all,\n\n${L1}\n${line}\nBarge: US$ 2,050 lumpsum\n${V}\n${SIG}`),
      o,
    );
    expectOutcome(r, "extracted");
    expect([r.normalised.deliveryFrom, r.normalised.deliveryTo]).toEqual([
      "2026-11-20",
      "2026-11-22",
    ]);
  });

  it("a forward that carries the original offer as an attachment, revised price on top: the stale attachment price → review", async () => {
    const body = `Dear all,\n\nRevised: LSMGO USD 683 per mt, delivery 22 Nov - 24 Nov 2026, rest as per attached original offer.\n${SIG}\n---------- Forwarded message ---------\nFrom: Luca Dubois <luca.dubois@harbourlight.example>\nDate: Wed, 11 Nov 2026 at 10:00\nSubject: Offer\n\nPlease find our offer attached.\n`;
    const att = `${G}\nQuantity: 100 mt\nPrice: USD 690 per mt\nDelivery: 25 Nov - 27 Nov 2026\nValid until: 13/11 17:00 LT\n`;
    const r = await ev(
      multipartEml(body, [{ name: "offer.txt", type: "text/plain", data: att }]),
      stale(),
    );
    expectOutcome(r, STALE);
  });
});

// ---------- rr/i2, rr/i2b, rr3/hedge-aw, rr3/hedge-e2e: amounts end to end ----------

describe("hedged and clean amounts, end to end", () => {
  const body = (q: string, p: string) =>
    `Dear all,\n\n${G}\n${q}\n${p}\nDelivery: 22 Nov - 24 Nov 2026\nBarge: US$ 2,050 lumpsum\nValid until: 14/11 17:00 LT\n${SIG}`;
  const P = "Price: USD 683 per mt";
  const out = (
    q: { value: number | null; unit: string; asWritten: string; evidence: string },
    p: { value: number; perUnit: string; asWritten: string; evidence: string },
  ) => {
    const o = clone(base);
    o.vesselName.evidence = G;
    o.port.evidence = G;
    o.lines[0].grade.evidence = G;
    o.lines[0].quantity = q;
    o.lines[0].price = { currency: "USD", ...p };
    return o;
  };
  const qty = (line: string, aw: string, value: number | null, evidence = line) =>
    ev(
      plainEml(body(line, P)),
      out(
        { value, unit: "mt", asWritten: aw, evidence },
        { value: 683, perUnit: "per mt", asWritten: "USD 683 per mt", evidence: P },
      ),
    );
  const price = (line: string, aw: string, value = 683) =>
    ev(
      plainEml(body("Quantity: 100 mt", line)),
      out(
        { value: 100, unit: "mt", asWritten: "100 mt", evidence: "Quantity: 100 mt" },
        { value, perUnit: "per mt", asWritten: aw, evidence: line },
      ),
    );

  it.each<[string, string, number, Outcome]>([
    // rr/i2
    ["Quantity: 100 mt", "100 mt", 100, "extracted"],
    ["Quantity: 100 - 150 mt", "100", 100, QTY],
    ["Quantity: 100 - 150 mt", "150 mt", 150, QTY],
    ["Quantity: between 100 and 150 mt", "100", 100, QTY],
    ["Quantity: around 100 mt", "100 mt", 100, QTY],
    ["Quantity: roughly 100 mt", "100 mt", 100, QTY],
    ["Quantity: c. 100 mt", "100 mt", 100, QTY],
    ["Quantity: 100 mt more or less", "100 mt", 100, QTY],
    ["Quantity: 100 mt MOLOO", "100 mt", 100, QTY],
    ["Quantity: 100mt-150mt", "100mt", 100, QTY],
    ["Quantity: 100 mt / 150 mt", "100 mt", 100, QTY],
    ["Quantity: 100 mt or 150 mt", "100 mt", 100, QTY],
    ["Quantity: at least 100 mt", "100 mt", 100, QTY],
    ["Quantity: 100+ mt", "100", 100, QTY],
    ["Quantity: ≈100 mt", "100 mt", 100, QTY],
    ["Quantity: 100 mt (Seller's option +/- 5%)", "100 mt", 100, QTY],
    ["Quantity: 100 mt, 10% more or less at Seller's option", "100 mt", 100, QTY],
    ["Quantity: 100 mt plus/minus 10%", "100 mt", 100, QTY],
    ["Quantity: 100 mt ±10%", "100 mt", 100, QTY],
    ["Quantity: 100 mt approx.", "100 mt", 100, QTY],
    ["Quantity: 100 - 150 mt", "100 - 150 mt", 100, QTY],
    // rr3/hedge-aw: the model keeps the hedged span in asWritten and writes the number
    ["Quantity: abt 100 mt", "abt 100 mt", 100, QTY],
    ["Quantity: approx. 100 mt", "approx. 100 mt", 100, QTY],
    ["Quantity: about 100 mt", "about 100 mt", 100, QTY],
    ["Quantity: min 100 mt", "min 100 mt", 100, QTY],
    ["Quantity: max. 100 mt", "max. 100 mt", 100, QTY],
    ["Quantity: up to 100 mt", "up to 100 mt", 100, QTY],
    ["Quantity: ~100 mt", "~100 mt", 100, QTY],
    ["Quantity: 100 mt approx.", "100 mt approx.", 100, QTY],
    ["Quantity: 100 mt +/- 5%", "100 mt +/- 5%", 100, QTY],
    ["Quantity: 100 mt MOLOO", "100 mt MOLOO", 100, QTY],
    ["Quantity: +/- 100 mt", "+/- 100 mt", 100, QTY],
    ["Quantity: c. 100 mt", "c. 100 mt", 100, QTY],
    ["Quantity: circa 100 mt", "circa 100 mt", 100, QTY],
    // rr3/hedge-e2e
    ["Quantity: +/- 100 mt", "100 mt", 100, QTY],
    ["Qty: ± 100 mt", "100 mt", 100, QTY],
    ["Qty: ±100 mt", "±100 mt", 100, QTY],
    ["Approximate quantity: 100 mt", "100 mt", 100, QTY],
    ["Maximum quantity: 100 mt", "100 mt", 100, QTY],
    ["Quantity: abt 100 mt", "100 mt", 100, QTY],
  ])("quantity %j as %j", async (line, aw, value, want) => {
    expectOutcome(await qty(line, aw, value), want);
  });

  it.each([
    ["Quantity: abt 100 mt", "100 mt"],
    ["Quantity: 100-150 mt", "150 mt"],
    ["Quantity: 100/150 mt", "150 mt"],
  ])("rr/i2: a shortened evidence span (%j cited as %j) → review", async (line, aw) => {
    expectOutcome(await qty(line, aw, Number(/\d+/.exec(aw)?.[0]), aw), QTY);
  });

  it.each<[string, string, Outcome]>([
    // rr/i2
    ["Price: USD 683-690 per mt", "USD 683", PRICE],
    ["Price: USD 683 / USD 690 per mt", "USD 683", PRICE],
    ["Price: USD 683 per mt or USD 690 per mt ex-pipe", "USD 683 per mt", PRICE],
    ["Price: around USD 683 per mt", "USD 683 per mt", PRICE],
    ["Price: indicatively USD 683 per mt", "USD 683 per mt", PRICE],
    ["Price: USD 683 per mt (Platts-linked, +/- daily)", "USD 683 per mt", PRICE],
    // rr3/hedge-aw
    ["Price: abt USD 683 per mt", "abt USD 683 per mt", PRICE],
    ["Price: approx. USD 683 per mt", "approx. USD 683 per mt", PRICE],
    ["Price: around USD 683 per mt", "around USD 683 per mt", PRICE],
    ["Price: USD 683 per mt approx.", "USD 683 per mt approx.", PRICE],
    ["Price: ~USD 683 per mt", "~USD 683 per mt", PRICE],
  ])("price %j as %j", async (line, aw, want) => {
    expectOutcome(await price(line, aw), want);
  });

  // rr/i2 clean lines: a marker near the amount that does not hedge it
  it.each<[string, string, string, string, string]>([
    [
      "Quantity: 100 mt",
      "100 mt",
      "Price: USD 683 per mt, delivery 22-24 Nov",
      "USD 683 per mt",
      "per mt",
    ],
    ["Quantity: 100 mt (max tank capacity 400 mt)", "100 mt", P, "USD 683 per mt", "per mt"],
    ["Quantity: 100 mt, min. lifting 50 mt", "100 mt", P, "USD 683 per mt", "per mt"],
    [
      "Quantity: 100 mt",
      "100 mt",
      "Price: USD 683 per mt (ISO 8217-2017)",
      "USD 683 per mt",
      "per mt",
    ],
    [
      "Quantity: 100 mt",
      "100 mt",
      "Price: USD 683 per mt, payment 30 days",
      "USD 683 per mt",
      "per mt",
    ],
    ["Qty: 100 mt to MV Scheldt Express", "100 mt", P, "USD 683 per mt", "per mt"],
    [
      "Quantity: 100 mt",
      "100 mt",
      "Price: USD 683 per mt - 30 days credit",
      "USD 683 per mt",
      "per mt",
    ],
  ])("clean: %j / %j → extracted", async (ql, qaw, pl, paw, perUnit) => {
    const r = await ev(
      plainEml(body(ql, pl)),
      out(
        { value: 100, unit: "mt", asWritten: qaw, evidence: ql },
        { value: 683, perUnit, asWritten: paw, evidence: pl },
      ),
    );
    expectOutcome(r, "extracted");
  });

  it("clean: one summary line 'LSMGO 0.10%S 100 mt @ USD 683/mt 22-24 Nov' → extracted", async () => {
    const line = "LSMGO 0.10%S 100 mt @ USD 683/mt 22-24 Nov";
    const r = await ev(
      plainEml(body(line, "")),
      out(
        { value: 100, unit: "mt", asWritten: "100 mt", evidence: line },
        { value: 683, perUnit: "/mt", asWritten: "USD 683/mt", evidence: line },
      ),
    );
    expectOutcome(r, "extracted");
  });

  it.each([
    ["LSMGO 0.1% / 100 mt / USD 683 pmt", "100 mt", "USD 683 pmt", "pmt"],
    ["LSMGO - 100 mt - USD 683/mt", "100 mt", "USD 683/mt", "/mt"],
  ])("clean (rr3 field separators): %j → extracted", async (line, qaw, paw, perUnit) => {
    const r = await ev(
      plainEml(body(line, "")),
      out(
        { value: 100, unit: "mt", asWritten: qaw, evidence: line },
        { value: 683, perUnit, asWritten: paw, evidence: line },
      ),
    );
    expectOutcome(r, "extracted");
  });

  describe("rr/i2b: tables, labelled units and CSV", () => {
    const tail = `Delivery: 22 Nov - 24 Nov 2026\nBarge: US$ 2,050 lumpsum\nValid until: 14/11 17:00 LT\n${SIG}`;
    const g = "Scheldt Express / Antwerp outer anchorage";
    const out2 = (q: Out, p: Out) => {
      const o = clone(base);
      o.vesselName.evidence = g;
      o.port.evidence = g;
      o.lines[0].grade = { value: "LSMGO", evidence: p.evidence };
      o.lines[0].quantity = q;
      o.lines[0].price = p;
      return o;
    };
    it("a table with the currency and unit in the header, numbers in the cells → review", async () => {
      const row = "LSMGO   100        683";
      const r = await ev(
        plainEml(
          `Dear all,\n\n${g}\nPrices in USD per mt:\nGrade   Qty (mt)   Price\n${row}\n${tail}`,
        ),
        out2(
          { value: 100, unit: "mt", asWritten: "100", evidence: row },
          { value: 683, currency: "USD", perUnit: "per mt", asWritten: "683", evidence: row },
        ),
      );
      expectOutcome(r, ["currency_known", "unit_known"]);
    });
    it("'Price (USD/mt): 683' with the number alone as asWritten → review", async () => {
      const r = await ev(
        plainEml(`Dear all,\n\n${g}\nLSMGO\nQuantity (mt): 100\nPrice (USD/mt): 683\n${tail}`),
        out2(
          { value: 100, unit: "mt", asWritten: "100", evidence: "Quantity (mt): 100" },
          {
            value: 683,
            currency: "USD",
            perUnit: "/mt",
            asWritten: "683",
            evidence: "Price (USD/mt): 683",
          },
        ),
      );
      expectOutcome(r, ["currency_known", "unit_known"]);
    });
    it("'USD/MT 683' notation → extracted", async () => {
      const line = "LSMGO 100 mt @ USD/MT 683";
      const r = await ev(
        plainEml(`Dear all,\n\n${g}\n${line}\n${tail}`),
        out2(
          { value: 100, unit: "mt", asWritten: "100 mt", evidence: line },
          { value: 683, currency: "USD", perUnit: "/MT", asWritten: "USD/MT 683", evidence: line },
        ),
      );
      expectOutcome(r, "extracted");
    });
    it("a CSV quote with units only in the header → review", async () => {
      const csv =
        "Vessel,Port,Grade,Qty (mt),Price (USD/mt),Delivery\nScheldt Express,Antwerp,LSMGO,100,683,22-24 Nov 2026\n";
      const row = "Scheldt Express,Antwerp,LSMGO,100,683,22-24 Nov 2026";
      const body = `Dear all,\n\nPlease find our offer attached.\nBarge: US$ 2,050 lumpsum\nValid until: 14/11 17:00 LT\n${SIG}`;
      const o = out2(
        { value: 100, unit: "mt", asWritten: "100", evidence: row },
        { value: 683, currency: "USD", perUnit: "per mt", asWritten: "683", evidence: row },
      );
      o.vesselName.evidence = row;
      o.port.evidence = row;
      o.deliveryFrom = { asWritten: "22-24 Nov 2026", evidence: row };
      o.deliveryTo = o.deliveryFrom;
      expectOutcome(
        await ev(multipartEml(body, [{ name: "offer.csv", type: "text/csv", data: csv }]), o),
        ["currency_known"],
      );
    });
    it.todo(
      "csvtok: 'LSMGO' and 'USD 683 per mt' inside a CSV row ('LSMGO,100 mt,...') fail the evidence token match, so a CSV quote goes to review (residual, review-direction)",
    );
  });
});

// ---------- rr/i3, rr/i3fr, rr/i3html, rr3/i3new, rr3/i3label: threads ----------

/** The model takes every value from the quoted older offer (USD 690, 25-27 Nov, 13/11). */
function stale(priceLine = "Price: USD 690 per mt", aw = "USD 690 per mt", perUnit = "per mt") {
  const o = clone(base);
  o.vesselName.evidence = G;
  o.port.evidence = G;
  o.lines[0].grade.evidence = G;
  o.lines[0].quantity = {
    value: 100,
    unit: "mt",
    asWritten: "100 mt",
    evidence: "Quantity: 100 mt",
  };
  o.lines[0].price = { value: 690, currency: "USD", perUnit, asWritten: aw, evidence: priceLine };
  o.deliveryFrom = {
    asWritten: "25 Nov - 27 Nov 2026",
    evidence: "Delivery: 25 Nov - 27 Nov 2026",
  };
  o.deliveryTo = o.deliveryFrom;
  o.validUntil = { asWritten: "13/11 17:00 LT", evidence: "Valid until: 13/11 17:00 LT" };
  o.bargeFee = NO_MONEY;
  return o;
}

describe("threads: the model takes the quoted older offer", () => {
  const OLD = `${G}\nQuantity: 100 mt\nPrice: USD 690 per mt\nDelivery: 25 Nov - 27 Nov 2026\nValid until: 13/11 17:00 LT\n`;
  const NEWEST = (price: string) =>
    `Dear all,\n\nRevised offer: ${price}, delivery 22 Nov - 24 Nov 2026, rest as below.\n${SIG}`;
  const EN =
    "________________________________\nFrom: Luca Dubois <luca.dubois@harbourlight.example>\nSent: 11 November 2026 10:00\nTo: Bunker Desk\nSubject: Offer\n\n";

  it.each([
    // rr/i3
    ["Outlook EN", EN],
    [
      "Outlook DE Von:/Gesendet:",
      "________________________________\nVon: Luca Dubois <luca.dubois@harbourlight.example>\nGesendet: Mittwoch, 11. November 2026 10:00\nAn: Bunker Desk\nBetreff: Offer\n\n",
    ],
    [
      "Outlook DA Fra:/Sendt:",
      "Fra: Luca Dubois <luca.dubois@harbourlight.example>\nSendt: 11. november 2026 10:00\nTil: Bunker Desk\nEmne: Offer\n\n",
    ],
    [
      "Outlook FR De:/Envoyé:",
      "De : Luca Dubois <luca.dubois@harbourlight.example>\nEnvoyé : mercredi 11 novembre 2026 10:00\nÀ : Bunker Desk\nObjet : Offer\n\n",
    ],
    [
      "Outlook EL Από:",
      "Από: Luca Dubois <luca.dubois@harbourlight.example>\nΣτάλθηκε: Τετάρτη, 11 Νοεμβρίου 2026 10:00\nΠρος: Bunker Desk\nΘέμα: Offer\n\n",
    ],
    ["German Ursprüngliche Nachricht", "-----Ursprüngliche Nachricht-----\nVon: Luca Dubois\n\n"],
    [
      "German Am … schrieb",
      "Am 11.11.2026 um 10:00 schrieb Luca Dubois <luca.dubois@harbourlight.example>:\n\n",
    ],
    [
      "Gmail wrapped attribution",
      "On Wed, 11 Nov 2026 at 10:00, Luca Dubois - Harbourlight Energy <\nluca.dubois@harbourlight.example> wrote:\n\n",
    ],
    [
      "From:/blank/Sent: (HTML conversion gap)",
      "From: Luca Dubois <luca.dubois@harbourlight.example>\n\nSent: 11 November 2026 10:00\n\nTo: Bunker Desk\n\n",
    ],
    [
      "*From:* bold markers",
      "*From:* Luca Dubois <luca.dubois@harbourlight.example>\n*Sent:* 11 November 2026 10:00\n\n",
    ],
    [
      "Apple Begin forwarded",
      "Begin forwarded message:\n\nFrom: Luca Dubois <luca.dubois@harbourlight.example>\nSubject: Offer\nDate: 11 November 2026 at 10:00:00 GMT\n\n",
    ],
    // rr3/i3new
    [
      "Outlook NL Van:/Verzonden:",
      "________________________________\nVan: Luca Dubois <luca.dubois@harbourlight.example>\nVerzonden: woensdag 11 november 2026 10:00\nAan: Bunker Desk\nOnderwerp: Offer\n\n",
    ],
    ["NL Oorspronkelijk bericht", "-----Oorspronkelijk bericht-----\nVan: Luca Dubois\n\n"],
    [
      "NL Op … schreef",
      "Op wo 11 nov. 2026 om 10:00 schreef Luca Dubois <luca.dubois@harbourlight.example>:\n\n",
    ],
    [
      "PT De:/Enviada:",
      "De: Luca Dubois <luca.dubois@harbourlight.example>\nEnviada: quarta-feira, 11 de novembro de 2026 10:00\nPara: Bunker Desk\nAssunto: Offer\n\n",
    ],
    [
      "PT Em … escreveu",
      "Em qua., 11 de nov. de 2026 às 10:00, Luca Dubois <luca.dubois@harbourlight.example> escreveu:\n\n",
    ],
    [
      "SV Från:/Skickat:",
      "Från: Luca Dubois <luca.dubois@harbourlight.example>\nSkickat: den 11 november 2026 10:00\nTill: Bunker Desk\nÄmne: Offer\n\n",
    ],
    [
      "EN sender name with a weekday word, no @",
      "________________________________\nFrom: Sun Marine Bunkers\nSent: 11 November 2026 10:00\nTo: Bunker Desk\nSubject: Offer\n\n",
    ],
    [
      "EN From: value on the next line",
      "From:\nLuca Dubois <luca.dubois@harbourlight.example>\nSent:\n11 November 2026 10:00\n\n",
    ],
    [
      "Gmail 3-line attribution",
      "On Wed, 11 Nov 2026 at 10:00, Luca Dubois - Harbourlight Energy Trading Desk\nAntwerp <\nluca.dubois@harbourlight.example> wrote:\n\n",
    ],
    [
      "Android -------- Original message --------",
      "-------- Original message --------\nFrom: Luca Dubois <luca.dubois@harbourlight.example>\nDate: 11/11/2026 10:00 (GMT+01:00)\n\n",
    ],
    [
      "Lotus '… wrote on 11/11/2026 10:00:'",
      "Luca Dubois/Harbourlight wrote on 11/11/2026 10:00:\n\n",
    ],
  ])("separator %s → review", async (_name, sep) => {
    expectOutcome(
      await ev(plainEml(`${NEWEST("LSMGO USD 683 per mt")}\n${sep}${OLD}`), stale()),
      STALE,
    );
  });

  it.todo("rr/i3: a bare '----' line is not taken as a separator (residual)");
  it.todo(
    "rr3/i3new: an Outlook-mobile 'From:' whose 'Sent:' is 7 non-empty lines below is past the 6-line header reach (residual, by the ruling)",
  );

  it.each([
    // rr/i3
    "LSMGO USD683/mt",
    "LSMGO USD/MT 683",
    "LSMGO 683.00 pmt (USD)",
    "LSMGO now 683 pmt",
    "LSMGO EUR683",
    "LSMGO USD683.50/mt",
    "LSMGO usd 683",
    "LSMGO 683$",
    // rr3/i3new
    "LSMGO price (USD/mt): 683",
    "LSMGO USD per mt: 683",
    "LSMGO price [USD/MT]: 683",
    "LSMGO 683/t",
    "LSMGO 683 per tonne",
    "LSMGO 683 p/mt",
    "LSMGO 683 per metric ton",
    "LSMGO in USD/mt = 683",
    "LSMGO 683,00 USD/mt",
    "LSMGO USD.683",
    "LSMGO USD 683",
    "LSMGO 683 US dollars",
    "LSMGO US$ 683",
    "LSMGO 683 usd/t",
  ])("the newest message prices as %j → review", async (p) => {
    expectOutcome(await ev(plainEml(`${NEWEST(p)}\n${EN}${OLD}`), stale()), STALE);
  });

  it("rr3/i3new: the newest offer as a header-row table (currency in the header) → review", async () => {
    const top = `Dear all,\n\nRevised offer below, rest as per our previous.\n\nGrade            Qty (mt)    Price (USD/mt)\nLSMGO 0.10%S     100         683\n${SIG}`;
    expectOutcome(await ev(plainEml(`${top}\n${EN}${OLD}`), stale()), STALE);
  });

  it.each([
    [
      "Price (USD/mt): N",
      (n: number) => `Price (USD/mt): ${n}`,
      (n: number) => `USD/mt): ${n}`,
      "/mt",
    ],
    [
      "Price [USD/MT]: N",
      (n: number) => `Price [USD/MT]: ${n}`,
      (n: number) => `USD/MT]: ${n}`,
      "/MT",
    ],
    [
      "Price, USD per mt: N",
      (n: number) => `Price, USD per mt: ${n}`,
      (n: number) => `USD per mt: ${n}`,
      "per mt",
    ],
    ["Price USD/mt: N", (n: number) => `Price USD/mt: ${n}`, (n: number) => `USD/mt: ${n}`, "/mt"],
  ] as const)(
    "rr3/i3label: %s in both messages: the older → review, the newest → extracted",
    async (_n, fmt, aw, perUnit) => {
      const tpl = (p: number, d: string, v: string) =>
        `${G}\nQuantity: 100 mt\n${fmt(p)}\nDelivery: ${d}\nValid until: ${v}\n`;
      const eml = plainEml(
        `Dear all,\n\nRevised:\n${tpl(683, "22 Nov - 24 Nov 2026", "14/11 17:00 LT")}${SIG}\n${EN}${tpl(690, "25 Nov - 27 Nov 2026", "13/11 17:00 LT")}`,
      );
      expectOutcome(await ev(eml, stale(fmt(690), aw(690), perUnit)), STALE);
      const current = stale(fmt(683), aw(683), perUnit);
      current.lines[0].price.value = 683;
      current.deliveryFrom = {
        asWritten: "22 Nov - 24 Nov 2026",
        evidence: "Delivery: 22 Nov - 24 Nov 2026",
      };
      current.deliveryTo = current.deliveryFrom;
      current.validUntil = { asWritten: "14/11 17:00 LT", evidence: "Valid until: 14/11 17:00 LT" };
      expectOutcome(await ev(eml, current), "extracted");
    },
  );

  it.each([
    ["'> ' kept in the evidence", true],
    ["evidence without '> '", false],
  ])("rr3/i3new: a bottom-posted reply (%s) → review", async (_what, prefixed) => {
    const body = `${OLD.trim()
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n")}\n\nRevised: LSMGO USD 683 per mt, delivery 22 Nov - 24 Nov 2026.\n${SIG}`;
    const o = stale();
    if (prefixed) {
      o.lines[0].price.evidence = "> Price: USD 690 per mt";
      o.lines[0].quantity.evidence = "> Quantity: 100 mt";
      o.deliveryFrom.evidence = "> Delivery: 25 Nov - 27 Nov 2026";
      o.validUntil.evidence = "> Valid until: 13/11 17:00 LT";
    }
    expectOutcome(await ev(plainEml(body), o), STALE);
  });

  const HTML_OLD = `<p>${G}</p><p>Quantity: 100 mt</p><p>Price: USD 690 per mt</p><p>Delivery: 25 Nov - 27 Nov 2026</p><p>Valid until: 13/11 17:00 LT</p>`;
  const HTML_TOP = `<p>Dear all,</p><p>Revised offer: LSMGO USD 683 per mt, delivery 22 Nov - 24 Nov 2026, rest as below.</p><p>BR, Luca Dubois<br>For and on behalf of Harbourlight Energy</p>`;
  it.each([
    [
      "Outlook HTML, header in one <p> with <br>",
      `${HTML_TOP}<div style="border-top:solid #E1E1E1 1.0pt"><p><b>From:</b> Luca Dubois<br><b>Sent:</b> 11 November 2026 10:00<br><b>To:</b> Bunker Desk<br><b>Subject:</b> Offer</p></div>${HTML_OLD}`,
    ],
    [
      "Outlook HTML, one <p> per header line",
      `${HTML_TOP}<div style="border-top:solid #E1E1E1 1.0pt"><p><b>From:</b> Luca Dubois</p><p><b>Sent:</b> 11 November 2026 10:00</p><p><b>To:</b> Bunker Desk</p></div>${HTML_OLD}`,
    ],
    [
      "Gmail HTML blockquote",
      `${HTML_TOP}<div class="gmail_quote"><div class="gmail_attr">On Wed, 11 Nov 2026 at 10:00, Luca Dubois &lt;luca.dubois@harbourlight.example&gt; wrote:<br></div><blockquote class="gmail_quote">${HTML_OLD}</blockquote></div>`,
    ],
    [
      "Outlook HTML <hr> then table header",
      `${HTML_TOP}<hr><table><tr><td><b>From:</b></td><td>Luca Dubois</td></tr><tr><td><b>Sent:</b></td><td>11 November 2026</td></tr></table>${HTML_OLD}`,
    ],
  ])("rr/i3html: %s → review", async (_name, html) => {
    expectOutcome(await ev(htmlEml(html), stale()), STALE);
  });

  it("rr/i3html: a forward (no price on top) of a revised offer over an older one, model takes the older → review", async () => {
    const body = `Hi team, FYI see below from Harbourlight.\n\n---------- Forwarded message ---------\nFrom: Luca Dubois <luca.dubois@harbourlight.example>\nDate: Thu, 12 Nov 2026\nSubject: RE: Offer\n\nRevised offer: LSMGO USD 683 per mt, delivery 22 Nov - 24 Nov 2026, rest as below.\n\n-----Original Message-----\nFrom: Luca Dubois\nSent: 11 November 2026 10:00\n\n${OLD}${SIG}`;
    expectOutcome(await ev(plainEml(body), stale()), STALE);
  });
});

describe("rr/i3fr: clean messages that must not split", () => {
  const out = (q: string, p: string, d: string, daw: string, v: string, vaw: string) => {
    const x = clone(base);
    x.vesselName.evidence = G;
    x.port.evidence = G;
    x.lines[0].grade.evidence = G;
    x.lines[0].quantity = { value: 100, unit: "mt", asWritten: "100 mt", evidence: q };
    x.lines[0].price = {
      value: 683,
      currency: "USD",
      perUnit: "per mt",
      asWritten: "USD 683 per mt",
      evidence: p,
    };
    x.deliveryFrom = { asWritten: daw, evidence: d };
    x.deliveryTo = { asWritten: daw, evidence: d };
    x.validUntil = { asWritten: vaw, evidence: v };
    x.bargeFee = NO_MONEY;
    return x;
  };
  const OFFER = `${G}\nQuantity: 100 mt\nPrice: USD 683 per mt\nDelivery: 22 Nov - 24 Nov 2026\nValid until: 14/11 17:00 LT\n`;
  const plainOut = () =>
    out(
      "Quantity: 100 mt",
      "Price: USD 683 per mt",
      "Delivery: 22 Nov - 24 Nov 2026",
      "22 Nov - 24 Nov 2026",
      "Valid until: 14/11 17:00 LT",
      "14/11 17:00 LT",
    );

  it("a delivery window laid out as From:/To: lines → extracted", async () => {
    const x = out(
      "Quantity: 100 mt",
      "Price: USD 683 per mt",
      "From: 22 Nov 2026",
      "22 Nov 2026",
      "Valid until: 14/11 17:00 LT",
      "14/11 17:00 LT",
    );
    x.deliveryTo = { asWritten: "24 Nov 2026", evidence: "To: 24 Nov 2026" };
    const body = `Dear all,\n\n${G}\nQuantity: 100 mt\nPrice: USD 683 per mt\nDelivery window\nFrom: 22 Nov 2026\nTo: 24 Nov 2026\nValid until: 14/11 17:00 LT\n${SIG}`;
    expectOutcome(await ev(plainEml(body), x), "extracted");
  });

  it("an attachment with a From:/To:/Date: form header → extracted", async () => {
    const att = `QUOTATION\nFrom: Harbourlight Energy\nTo: Bunker Desk / Owners of Scheldt Express\nDate: 12 Nov 2026\n\n${OFFER}`;
    const body = `Dear all,\n\nPlease see our offer attached, LSMGO at USD 683 per mt.\n${SIG}`;
    expectOutcome(
      await ev(
        multipartEml(body, [{ name: "quotation.txt", type: "text/plain", data: att }]),
        plainOut(),
      ),
      "extracted",
    );
  });

  it("a reply with the new offer attached and the enquiry quoted → extracted", async () => {
    const body = `Dear all,\n\nRevised offer attached: USD 683 per mt.\n${SIG}\nOn Wed, 11 Nov 2026 at 10:00, Bunker Desk <bunker-desk@pharos-demo.example> wrote:\n> Please quote LSMGO for Scheldt Express at Antwerp.\n`;
    expectOutcome(
      await ev(
        multipartEml(body, [{ name: "offer.txt", type: "text/plain", data: OFFER }]),
        plainOut(),
      ),
      "extracted",
    );
  });

  it("a reply taking quantity and dates from the buyer's quoted enquiry → review", async () => {
    const line =
      "We offer LSMGO 0.10%S at USD 683 per mt for the quantity and dates requested. Valid until: 14/11 17:00 LT";
    const body = `Dear all,\n\n${line}\n${SIG}\nOn Wed, 11 Nov 2026 at 10:00, Bunker Desk <bunker-desk@pharos-demo.example> wrote:\n> ${G}\n> Quantity: 100 mt\n> Delivery: 22 Nov - 24 Nov 2026\n`;
    const x = out(
      "Quantity: 100 mt",
      line,
      "Delivery: 22 Nov - 24 Nov 2026",
      "22 Nov - 24 Nov 2026",
      line,
      "14/11 17:00 LT",
    );
    expectOutcome(await ev(plainEml(body), x), STALE);
  });

  it("a single '>' note line → extracted", async () => {
    const body = `Dear all,\n\n${G}\nQuantity: 100 mt\nPrice: USD 683 per mt\n> Note: minimum lifting applies\nDelivery: 22 Nov - 24 Nov 2026\nValid until: 14/11 17:00 LT\n${SIG}`;
    expectOutcome(await ev(plainEml(body), plainOut()), "extracted");
  });
});
