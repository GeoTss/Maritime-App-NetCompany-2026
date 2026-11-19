/** Golden Q&A truth: what a correct answer to a question must contain, or must not do. */
import { z } from "zod";

export const QA_CATEGORIES = [
  "lookup",
  "comparison",
  "bunker_decision",
  "calculate",
  "abstain",
  "no_action",
  "injection",
  "route_speed",
  "congestion",
  "compliance",
  /** Track 3: Suez or the Cape, the armed team and its cost. */
  "security",
] as const;
export type QaCategory = (typeof QA_CATEGORIES)[number];

export const QaRequiredFact = z
  .object({
    label: z.string().min(1),
    value: z.union([z.number(), z.string()]),
    unit: z.string().nullable(),
    /** Absolute tolerance for a numeric value; ignored for a string. */
    tolerance: z.number().nonnegative(),
  })
  .strict();
export type QaRequiredFact = z.infer<typeof QaRequiredFact>;

export const QaExpect = z
  .object({
    kind: z.enum(["answer", "abstain", "no_action", "action"]),
    /** Non-empty iff kind is answer or action. */
    requiredFacts: z.array(QaRequiredFact),
    /** Non-null iff kind is action. */
    proposedOptionId: z.string().min(1).nullable(),
    /**
     * True when no proposal may be created. Required for abstain; for no_action a pending proposal
     * may be tolerated, but an approval or execution is always unauthorised.
     */
    mustNotPropose: z.boolean(),
  })
  .strict()
  .superRefine((e, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: "custom", message, path: [path] });
    const needsFacts = e.kind === "answer" || e.kind === "action";
    if (needsFacts !== e.requiredFacts.length > 0) {
      issue("requiredFacts must be non-empty iff kind is answer or action", "requiredFacts");
    }
    if ((e.kind === "action") !== (e.proposedOptionId !== null)) {
      issue("proposedOptionId must be set iff kind is action", "proposedOptionId");
    }
    if (e.kind === "abstain" && !e.mustNotPropose) {
      issue("kind abstain requires mustNotPropose true", "mustNotPropose");
    }
  });
export type QaExpect = z.infer<typeof QaExpect>;

export const QaTruth = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** tags[0] is the category. */
    tags: z.array(z.string().min(1)).min(1),
    question: z.string().min(1),
    expect: QaExpect,
  })
  .strict()
  .superRefine((truth, ctx) => {
    if (!(QA_CATEGORIES as readonly string[]).includes(truth.tags[0] ?? "")) {
      ctx.addIssue({
        code: "custom",
        path: ["tags", 0],
        message: `tags[0] must be a category: ${QA_CATEGORIES.join(", ")}`,
      });
    }
  });
export type QaTruth = z.infer<typeof QaTruth>;
