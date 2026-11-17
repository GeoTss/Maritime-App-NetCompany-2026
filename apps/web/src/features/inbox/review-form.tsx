import {
  type Currency,
  FUEL_GRADES,
  type FuelGrade,
  type InboxItemDetail,
  type QuoteExtraction,
  type ReviewCorrection,
  ReviewCorrection as ReviewCorrectionSchema,
  type ReviewItem,
  type ReviewReference,
} from "@pharos/shared";
import { useMemo, useState } from "react";
import { type DiffRow, DiffTable } from "@/components/primitives/diff-table";
import { StateFlag } from "@/components/primitives/state-flag";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UntrustedText } from "@/components/untrusted-text";
import { possessive } from "@/lib/format";

interface LineState {
  grade: string;
  qty: string;
  price: string;
}
export interface FormState {
  vesselId: string;
  portId: string;
  supplierId: string;
  currency: string;
  validUntil: string;
  deliveryFrom: string;
  deliveryTo: string;
  bargeFee: string;
  lines: LineState[];
}

const text = (v: number | string | null | undefined) =>
  v === null || v === undefined ? "" : String(v);

/** The form starts from the code's own normalisation; the ambiguous value stays empty. */
export function initialState(review: ReviewItem): FormState {
  const n = review.normalised;
  return {
    vesselId: text(n.vesselId),
    portId: text(n.portId),
    supplierId: text(n.supplierId),
    currency: text(n.currency),
    validUntil: text(n.validUntil),
    deliveryFrom: text(n.deliveryFrom),
    deliveryTo: text(n.deliveryTo),
    bargeFee: text(n.bargeFee),
    lines: n.lines.map((l) => ({
      grade: text(l.grade),
      qty: text(l.qtyMt),
      price: text(l.pricePerMt),
    })),
  };
}

const num = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Turns the form into the contract's shape, or null while something is missing. The contract
 * schema is the validator: the button enables only when the API would accept the body.
 */
export function buildCorrection(
  form: FormState,
  reference: ReviewReference,
): ReviewCorrection | null {
  const vessel = reference.vessels.find((v) => String(v.id) === form.vesselId);
  const port = reference.ports.find((p) => String(p.id) === form.portId);
  const candidate = {
    vesselImo: vessel?.imo,
    portUnlocode: port?.unlocode,
    supplierId: num(form.supplierId),
    currency: form.currency,
    validUntil: form.validUntil === "" ? null : form.validUntil,
    deliveryFrom: form.deliveryFrom === "" ? null : form.deliveryFrom,
    deliveryTo: form.deliveryTo === "" ? null : form.deliveryTo,
    bargeFee: num(form.bargeFee),
    lines: form.lines.map((l) => ({ grade: l.grade, qtyMt: num(l.qty), pricePerMt: num(l.price) })),
  };
  const parsed = ReviewCorrectionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Which required fields are still empty, by name, so the reviewer knows what to fill. */
export function missingFields(form: FormState): string[] {
  const out: string[] = [];
  if (!form.vesselId) out.push("Vessel");
  if (!form.portId) out.push("Port");
  if (!form.supplierId) out.push("Supplier");
  if (!form.currency) out.push("Currency");
  if (num(form.bargeFee) === null) out.push("Barge fee");
  form.lines.forEach((l, i) => {
    const n = form.lines.length > 1 ? `, line ${i + 1}` : "";
    if (!l.grade) out.push(`Grade${n}`);
    if (num(l.qty) === null) out.push(`Quantity${n}`);
    if (num(l.price) === null) out.push(`Price${n}`);
  });
  return out;
}

const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Written → corrected rows. `changed` is a comparison of the two, not a computed number. */
export function diffRows(
  q: QuoteExtraction,
  form: FormState,
  reference: ReviewReference,
): DiffRow[] {
  const vessel = reference.vessels.find((v) => String(v.id) === form.vesselId);
  const port = reference.ports.find((p) => String(p.id) === form.portId);
  const supplier = reference.suppliers.find((s) => String(s.id) === form.supplierId);
  const dash = "—";
  const rows: DiffRow[] = [
    {
      key: "supplier",
      label: "Supplier",
      before: q.supplierName.value ?? dash,
      after: supplier?.name ?? dash,
      changed: squash(q.supplierName.value) !== squash(supplier?.name),
    },
    {
      key: "vessel",
      label: "Vessel",
      before: q.vesselName.value ?? q.vesselImo.value ?? dash,
      after: vessel ? `${vessel.name} (IMO ${vessel.imo})` : dash,
      changed: !squash(vessel?.name).includes(squash(q.vesselName.value)) || !q.vesselName.value,
    },
    {
      key: "port",
      label: "Port",
      before: q.port.value ?? dash,
      after: port ? `${port.name} (${port.unlocode})` : dash,
      changed: !squash(port?.name).includes(squash(q.port.value)) || !q.port.value,
    },
    {
      key: "currency",
      label: "Currency",
      before: q.lines[0]?.price.currency ?? dash,
      after: form.currency || dash,
      changed: squash(q.lines[0]?.price.currency) !== squash(form.currency),
    },
    {
      key: "validUntil",
      label: "Valid until",
      before: q.validUntil.asWritten ?? dash,
      after: form.validUntil || dash,
    },
    {
      key: "from",
      label: "Delivery from",
      before: q.deliveryFrom.asWritten ?? dash,
      after: form.deliveryFrom || dash,
    },
    {
      key: "to",
      label: "Delivery to",
      before: q.deliveryTo.asWritten ?? dash,
      after: form.deliveryTo || dash,
    },
    {
      key: "barge",
      label: "Barge fee",
      before: q.bargeFee.asWritten ?? dash,
      after: form.bargeFee === "" ? dash : `${form.currency} ${form.bargeFee}`.trim(),
      changed: q.bargeFee.value === null || q.bargeFee.value !== num(form.bargeFee),
    },
  ];
  form.lines.forEach((l, i) => {
    const src = q.lines[i];
    const n = form.lines.length > 1 ? ` ${i + 1}` : "";
    rows.push(
      {
        key: `grade${i}`,
        label: `Grade${n}`,
        before: src?.grade.value ?? dash,
        after: l.grade || dash,
        changed: squash(src?.grade.value) !== squash(l.grade),
      },
      {
        key: `qty${i}`,
        label: `Quantity${n}`,
        before: src?.quantity.asWritten ?? dash,
        after: l.qty === "" ? dash : `${l.qty} mt`,
        changed: src?.quantity.value == null || src.quantity.value !== num(l.qty),
      },
      {
        key: `price${i}`,
        label: `Price${n}`,
        before: src?.price.asWritten ?? dash,
        after: l.price === "" ? dash : `${form.currency} ${l.price}/mt`.trim(),
        changed:
          src?.price.value == null ||
          src.price.value !== num(l.price) ||
          squash(src.price.currency) !== squash(form.currency),
      },
    );
  });
  return rows;
}

/** Which line values the checks flagged: a null normalised value, or a failed check naming the line. */
export function flaggedFields(review: ReviewItem): { qty: Set<number>; price: Set<number> } {
  const qty = new Set<number>();
  const price = new Set<number>();
  review.normalised.lines.forEach((l, i) => {
    if (l.qtyMt === null || l.qtyMt === undefined) qty.add(i);
    if (l.pricePerMt === null || l.pricePerMt === undefined) price.add(i);
  });
  for (const c of review.failedChecks) {
    const m = /\b(Quantity|Price)\b[^.]*?\bline (\d+)/i.exec(c.detail ?? "");
    if (!m) continue;
    (m[1]?.toLowerCase() === "quantity" ? qty : price).add(Number(m[2]));
  }
  return { qty, price };
}

/** The value as the email wrote it: untrusted text, shown verbatim, never read as a number. */
function SourceLine({
  id,
  testId,
  written,
}: {
  id: string;
  testId: string;
  written?: string | null;
}) {
  return (
    <p id={id} data-testid={testId} className="text-2xs text-caution">
      In the email:{" "}
      <UntrustedText
        text={written ?? null}
        fallback="not stated"
        className="font-verbatim whitespace-pre-wrap text-text-1"
      />
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 text-xs text-text-2">
      <span className="font-label">{label}</span>
      {children}
    </div>
  );
}

/**
 * Fix a held quote. Starts from the code's normalisation, shows the ambiguous value as written,
 * and lists written → corrected before anything is saved. Accepting is an operator input behind a
 * dialog that says what will happen; it posts exactly the `ReviewCorrection` body.
 */
export function ReviewForm({
  detail,
  review,
  reference,
  busy,
  onAccept,
  onReject,
}: {
  detail: InboxItemDetail;
  review: ReviewItem;
  reference: ReviewReference;
  busy: boolean;
  onAccept: (correction: ReviewCorrection) => void;
  onReject: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(review));
  const [confirming, setConfirming] = useState(false);
  const correction = useMemo(() => buildCorrection(form, reference), [form, reference]);
  const q = detail.extraction?.kind === "quote" ? detail.extraction : null;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setLine = (i: number, patch: Partial<LineState>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const supplier = reference.suppliers.find((s) => String(s.id) === form.supplierId);
  const port = reference.ports.find((p) => String(p.id) === form.portId);
  const vessel = reference.vessels.find((v) => String(v.id) === form.vesselId);

  const flagged = useMemo(() => flaggedFields(review), [review]);
  const lineFlag = (i: number) => ({ qty: flagged.qty.has(i), price: flagged.price.has(i) });
  const settled = (i: number, k: "qty" | "price") => num(form.lines[i]?.[k] ?? "") !== null;

  const vesselC = (
    <Field label="Vessel">
      <Select value={form.vesselId} onValueChange={(v) => set("vesselId", v)}>
        <SelectTrigger aria-label="Vessel" className="w-full">
          <SelectValue placeholder="Choose a vessel" />
        </SelectTrigger>
        <SelectContent>
          {reference.vessels.map((v) => (
            <SelectItem key={v.id} value={String(v.id)}>
              {v.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  const portC = (
    <Field label="Port">
      <Select value={form.portId} onValueChange={(v) => set("portId", v)}>
        <SelectTrigger aria-label="Port" className="w-full">
          <SelectValue placeholder="Choose a port" />
        </SelectTrigger>
        <SelectContent>
          {reference.ports.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  const supplierC = (
    <Field label="Supplier">
      <Select value={form.supplierId} onValueChange={(v) => set("supplierId", v)}>
        <SelectTrigger aria-label="Supplier" className="w-full">
          <SelectValue placeholder="Choose a supplier" />
        </SelectTrigger>
        <SelectContent>
          {reference.suppliers.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  const currencyC = (
    <Field label="Currency">
      <Select value={form.currency} onValueChange={(v) => set("currency", v as Currency)}>
        <SelectTrigger aria-label="Currency" className="w-full">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {(["USD", "EUR"] as const).map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  const bargeC = (
    <Field label="Barge fee">
      <Input
        aria-label="Barge fee"
        type="number"
        min={0}
        step="any"
        value={form.bargeFee}
        onChange={(e) => set("bargeFee", e.target.value)}
      />
    </Field>
  );
  const dateC = (label: string, key: "validUntil" | "deliveryFrom" | "deliveryTo") => (
    <Field label={label}>
      <Input
        aria-label={label}
        type="date"
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </Field>
  );
  const gradeC = (i: number, line: LineState) => (
    <Field label={form.lines.length > 1 ? `Grade, line ${i + 1}` : "Grade"}>
      <Select value={line.grade} onValueChange={(v) => setLine(i, { grade: v as FuelGrade })}>
        <SelectTrigger aria-label={`Grade, line ${i + 1}`} className="w-full">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {FUEL_GRADES.map((g) => (
            <SelectItem key={g} value={g}>
              {g}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  const qtyInput = (i: number, line: LineState, flag: boolean) => (
    <Input
      aria-label={`Quantity in mt, line ${i + 1}`}
      aria-invalid={flag && !settled(i, "qty") ? true : undefined}
      aria-describedby={flag ? `src-qty-${i}` : undefined}
      type="number"
      min={0}
      step="any"
      value={line.qty}
      onChange={(e) => setLine(i, { qty: e.target.value })}
    />
  );
  const priceInput = (i: number, line: LineState, flag: boolean) => (
    <Input
      aria-label={`Price per mt, line ${i + 1}`}
      aria-invalid={flag && !settled(i, "price") ? true : undefined}
      aria-describedby={flag ? `src-price-${i}` : undefined}
      type="number"
      min={0}
      step="any"
      value={line.price}
      onChange={(e) => setLine(i, { price: e.target.value })}
    />
  );

  // Needs you: the flagged line values, each beside its as-written text from the email.
  const needs: { key: string; node: React.ReactNode; done: boolean }[] = [];
  form.lines.forEach((line, i) => {
    const flag = lineFlag(i);
    const src = q?.lines[i];
    if (flag.qty) {
      needs.push({
        key: `qty${i}`,
        done: settled(i, "qty"),
        node: (
          <Field label={`Quantity (mt)${form.lines.length > 1 ? `, line ${i + 1}` : ""}`}>
            <SourceLine
              id={`src-qty-${i}`}
              testId={`written-qty-${i}`}
              written={src?.quantity.asWritten}
            />
            {qtyInput(i, line, true)}
          </Field>
        ),
      });
    }
    if (flag.price) {
      needs.push({
        key: `price${i}`,
        done: settled(i, "price"),
        node: (
          <Field
            label={`Price (${form.currency || "currency"} per mt)${form.lines.length > 1 ? `, line ${i + 1}` : ""}`}
          >
            <SourceLine
              id={`src-price-${i}`}
              testId={`written-price-${i}`}
              written={src?.price.asWritten}
            />
            {priceInput(i, line, true)}
          </Field>
        ),
      });
    }
  });
  const open = needs.filter((n) => !n.done).length;

  // The rest: what the email states (matches) and what it does not (optional dates, barge fee).
  const optional: { key: string; written: string | null | undefined; node: React.ReactNode }[] = [
    { key: "valid", written: q?.validUntil.asWritten, node: dateC("Valid until", "validUntil") },
    {
      key: "from",
      written: q?.deliveryFrom.asWritten,
      node: dateC("Delivery from", "deliveryFrom"),
    },
    { key: "to", written: q?.deliveryTo.asWritten, node: dateC("Delivery to", "deliveryTo") },
    {
      key: "barge",
      written: q?.bargeFee.asWritten ?? (q?.bargeFee.value ?? null)?.toString(),
      node: bargeC,
    },
  ];
  const notInEmail = q ? optional.filter((o) => !o.written) : [];
  const matches: { key: string; node: React.ReactNode }[] = [
    { key: "vessel", node: vesselC },
    { key: "port", node: portC },
    { key: "supplier", node: supplierC },
    { key: "currency", node: currencyC },
    ...(q ? optional.filter((o) => o.written) : optional).map(({ key, node }) => ({ key, node })),
  ];
  form.lines.forEach((line, i) => {
    const flag = lineFlag(i);
    matches.push({ key: `grade${i}`, node: gradeC(i, line) });
    if (!flag.qty) {
      matches.push({
        key: `qty${i}`,
        node: <Field label="Quantity (mt)">{qtyInput(i, line, false)}</Field>,
      });
    }
    if (!flag.price) {
      matches.push({
        key: `price${i}`,
        node: (
          <Field label={`Price (${form.currency || "currency"} per mt)`}>
            {priceInput(i, line, false)}
          </Field>
        ),
      });
    }
  });
  const needsFold = missingFields(form).some((f) => /^(Barge fee)/.test(f));
  const [foldOpen, setFoldOpen] = useState(needsFold);

  return (
    <section aria-label="Fix this quote" className="flex flex-col gap-3 px-3 py-3">
      <div>
        <h3 className="font-title text-sm font-medium text-text-1">Needs a human fix</h3>
        <p className="max-w-[60ch] text-xs text-text-2">
          Only what the checks could not settle is asked of you. Nothing is saved until you accept.
        </p>
      </div>

      {needs.length > 0 ? (
        <section aria-label="Needs you" className="flex flex-col gap-2">
          <h4 className="flex items-center gap-1.5 font-label text-xs text-text-1">
            <StateFlag kind="K" />
            {open > 0 ? `Needs you · ${open}` : `Settled by you · ${needs.length}`}
          </h4>
          <div className="grid grid-cols-1 gap-2 border border-line p-2 sm:grid-cols-2">
            {needs.map((n) => (
              <div key={n.key}>{n.node}</div>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label="Matches the email" className="flex flex-col gap-2">
        <h4 className="font-label text-xs text-text-2">Matches the email · {matches.length}</h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {matches.map((m) => (
            <div key={m.key}>{m.node}</div>
          ))}
        </div>
      </section>

      {notInEmail.length > 0 ? (
        <Collapsible open={foldOpen} onOpenChange={setFoldOpen}>
          <CollapsibleTrigger className="flex items-center gap-1.5 font-label text-xs text-text-2 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-ring/60">
            Not in the email · {notInEmail.length}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="pt-1 text-2xs text-text-3">
              The email does not state these. Add a value only if you know it.
            </p>
            <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-3">
              {notInEmail.map((m) => (
                <div key={m.key}>{m.node}</div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {q ? (
        <div className="flex flex-col gap-1">
          <h4 className="font-label text-xs text-text-2">As written, then corrected</h4>
          <DiffTable
            rows={diffRows(q, form, reference)}
            beforeLabel="As written"
            afterLabel="Corrected"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!correction || busy} onClick={() => setConfirming(true)}>
          Accept correction
        </Button>
        <Button variant="outline" disabled={busy} onClick={onReject}>
          Reject quote
        </Button>
        {correction ? null : (
          <span data-testid="missing-fields" className="text-xs text-text-3">
            {missingFields(form).length > 0
              ? `Still needed: ${missingFields(form).join(", ")}.`
              : "Check the values: one is not valid."}
          </span>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept this correction?</DialogTitle>
            <DialogDescription>
              This saves {possessive(supplier?.name ?? "the supplier")} quote for{" "}
              {vessel?.name ?? "the vessel"} at {port?.name ?? "the port"} with your corrected
              values and marks the email accepted. It places no order and sends nothing to the
              supplier.
            </DialogDescription>
          </DialogHeader>
          <ul aria-label="Corrected values" className="flex flex-col gap-0.5 text-xs text-text-1">
            {form.lines.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: form lines have no id; order is fixed while the dialog is open
              <li key={`c-${i}`}>
                {l.qty} mt {l.grade} at {form.currency} {l.price} per mt
              </li>
            ))}
            <li>
              Barge fee {form.currency} {form.bargeFee}
            </li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Back to the form
            </Button>
            <Button
              disabled={!correction || busy}
              onClick={() => {
                if (!correction) return;
                setConfirming(false);
                onAccept(correction);
              }}
            >
              Save corrected quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
