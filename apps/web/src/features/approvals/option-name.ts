/**
 * Human names for option ids a proposal's facts carry ("B", "MTMLA-kestrel"). The fact's value is
 * never changed; the name is shown beside it. Lookups only, no arithmetic: first the proposal's
 * own facts (a route's description fact, an option fact labelled "<id> (<supplier>, <port>): …"),
 * then the reference names the API serves (port by UN/LOCODE, supplier by the option's key).
 */
import type { Fact, ReviewReference } from "@pharos/shared";

type Names = Pick<ReviewReference, "ports" | "suppliers">;

const isOptionFact = (f: Fact) =>
  f.provenance.source === "calculation" &&
  /(^|\.)(bestCandidateId|bestOptionId)$/.test(f.provenance.path);

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The name of the option a fact's value names, or null when nothing says it. */
export function optionName(fact: Fact, facts: Fact[], names: Names | null): string | null {
  if (!isOptionFact(fact) || typeof fact.value !== "string") return null;
  const id = fact.value;
  // A route candidate: its description fact ("…, route B: description" = "Shortest sea route").
  const description = facts.find(
    (f) =>
      typeof f.value === "string" &&
      new RegExp(`route ${escapeRegExp(id)}: description$`).test(f.label),
  );
  if (description) return String(description.value);
  // A bunker option fact labelled "<id> (<supplier>, <port>): <field>".
  const labelled = facts
    .map((f) => new RegExp(`^${escapeRegExp(id)} \\(([^)]+)\\):`).exec(f.label)?.[1])
    .find((x): x is string => Boolean(x));
  if (labelled) return labelled;
  // A bunker option id is "<UN/LOCODE>-<supplier key>": name the port, and the supplier when
  // exactly one supplier's name starts with the key.
  const m = /^([A-Z]{2}[A-Z0-9]{3})-([a-z0-9]+)$/.exec(id);
  if (!m || !names) return null;
  const port = names.ports.find((p) => p.unlocode === m[1])?.name ?? null;
  const suppliers = names.suppliers.filter((s) => squash(s.name).startsWith(m[2] ?? ""));
  const supplier = suppliers.length === 1 ? (suppliers[0]?.name ?? null) : null;
  if (supplier && port) return `${supplier} at ${port}`;
  return supplier ?? (port ? `at ${port}` : null);
}

/** Whether any fact in the list names an option (so the reference names are worth reading). */
export const hasOptionFact = (facts: Fact[]) => facts.some(isOptionFact);
