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
import { Button } from "@/components/ui/button";
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

  return (
    <section aria-label="Fix this quote" className="flex flex-col gap-3 px-3 py-3">
      <div>
        <h3 className="font-title text-sm font-medium text-text-1">Needs a human fix</h3>
        <p className="max-w-[60ch] text-xs text-text-2">
          Check each value against the email, correct what the extraction could not settle, then
          accept. Nothing is saved until you accept.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
        <Field label="Valid until">
          <Input
            aria-label="Valid until"
            type="date"
            value={form.validUntil}
            onChange={(e) => set("validUntil", e.target.value)}
          />
        </Field>
        <Field label="Delivery from">
          <Input
            aria-label="Delivery from"
            type="date"
            value={form.deliveryFrom}
            onChange={(e) => set("deliveryFrom", e.target.value)}
          />
        </Field>
        <Field label="Delivery to">
          <Input
            aria-label="Delivery to"
            type="date"
            value={form.deliveryTo}
            onChange={(e) => set("deliveryTo", e.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        {form.lines.map((line, i) => {
          const written = q?.lines[i]?.quantity.asWritten;
          const key = `line-${i}`;
          return (
            <fieldset
              key={key}
              className="grid grid-cols-1 gap-2 border border-line p-2 sm:grid-cols-3"
            >
              <legend className="px-1 text-xs text-text-2">Line {i + 1}</legend>
              <Field label="Grade">
                <Select
                  value={line.grade}
                  onValueChange={(v) => setLine(i, { grade: v as FuelGrade })}
                >
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
              <Field label="Quantity (mt)">
                <Input
                  aria-label={`Quantity in mt, line ${i + 1}`}
                  type="number"
                  min={0}
                  step="any"
                  value={line.qty}
                  onChange={(e) => setLine(i, { qty: e.target.value })}
                />
                {written ? (
                  <span data-testid={`written-qty-${i}`} className="text-2xs text-caution">
                    Written as <bdi className="font-medium">{written}</bdi>
                  </span>
                ) : null}
              </Field>
              <Field label={`Price (${form.currency || "currency"} per mt)`}>
                <Input
                  aria-label={`Price per mt, line ${i + 1}`}
                  type="number"
                  min={0}
                  step="any"
                  value={line.price}
                  onChange={(e) => setLine(i, { price: e.target.value })}
                />
              </Field>
            </fieldset>
          );
        })}
      </div>

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
          <span className="text-xs text-text-3">Fill every field above to accept.</span>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept this correction?</DialogTitle>
            <DialogDescription>
              This saves {supplier?.name ?? "the supplier"}'s quote for{" "}
              {vessel?.name ?? "the vessel"} at {port?.name ?? "the port"} with your corrected
              values and marks the email accepted. It places no order and sends nothing to the
              supplier.
            </DialogDescription>
          </DialogHeader>
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
