/**
 * LLM 1: one structured-output call that transcribes an email into `ExtractionOutput`.
 * The model only transcribes; normalisation, resolution and checks happen in code afterwards.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractionOutput } from "@pharos/shared";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { withCallCapture } from "./call-capture.js";
import { FALLBACK_BETA, usesFallbacks } from "./fallbacks.js";
import type { CallMetrics } from "./llm.js";
import { EXTRACT_QUOTE_SYSTEM, PROMPT_VERSION } from "./prompts/extract-quote.js";

export interface ExtractInput {
  subject: string | null;
  sender: string | null;
  /** The body, then each readable attachment under a `--- attachment: <name> ---` line. */
  bodyText: string;
}

export interface ExtractResult {
  output: ExtractionOutput;
  /** Every model call the extraction made (one, unless the SDK retried a failed request). */
  metrics: CallMetrics[];
}

export interface Extractor {
  /** Stored on the extraction row. */
  readonly model: string;
  readonly promptVersion: string;
  extract(doc: ExtractInput): Promise<ExtractResult>;
}

export type ExtractorConfig = Pick<AppConfig, "extractModel" | "extractEffort" | "llmFallbacks">;

/** The model made a call but its output cannot be used (refusal, truncation, invalid JSON). */
export class ExtractionError extends Error {
  override name = "ExtractionError";
  constructor(
    message: string,
    readonly metrics: CallMetrics[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Fits a non-streaming request; extraction output is a few hundred tokens plus thinking. */
const MAX_TOKENS = 16_000;

/**
 * The response schema: `ExtractionOutput` under one key. Structured outputs reject a root-level
 * `anyOf` next to `$defs` (400 "For 'anyOf', '$defs' is not supported"), which is what the
 * discriminated union compiles to on its own.
 */
export const ExtractionEnvelope = z.object({ extraction: ExtractionOutput }).strict();

const OPEN = "<email_document>";
const CLOSE = "</email_document>";

/** Neutralises any delimiter tag inside untrusted text so the email cannot close its block. */
function escapeDelimiters(text: string): string {
  return text.replace(/<\s*(\/?)\s*email_document\b/gi, "&lt;$1email_document");
}

/**
 * The user turn: the email as delimited, untrusted data. Deterministic for the same email, so
 * record/replay keys are stable. Code checks evidence against `sourceText` of the same email.
 */
export function renderEmailDocument(doc: ExtractInput): string {
  return `${OPEN}\n${escapeDelimiters(sourceText(doc))}\n${CLOSE}`;
}

/**
 * The text the model reads (sender, subject, body with its attachment sections), unescaped:
 * what evidence must quote.
 */
export function sourceText(doc: ExtractInput): string {
  return `From: ${doc.sender ?? ""}\nSubject: ${doc.subject ?? ""}\n\n${doc.bodyText}`;
}

export function createLlmExtractor(llm: { client: Anthropic }, config: ExtractorConfig): Extractor {
  const base = {
    model: config.extractModel,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text: EXTRACT_QUOTE_SYSTEM,
        cache_control: { type: "ephemeral" as const },
      },
    ],
  };

  const call = async (doc: ExtractInput) => {
    const messages = [{ role: "user" as const, content: renderEmailDocument(doc) }];
    if (usesFallbacks(config.extractModel, config.llmFallbacks)) {
      const msg = await llm.client.beta.messages.parse({
        ...base,
        messages,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: {
          effort: config.extractEffort,
          format: betaZodOutputFormat(ExtractionEnvelope),
        },
      });
      return { stopReason: msg.stop_reason, parsed: msg.parsed_output };
    }
    const msg = await llm.client.messages.parse({
      ...base,
      messages,
      output_config: { effort: config.extractEffort, format: zodOutputFormat(ExtractionEnvelope) },
    });
    return { stopReason: msg.stop_reason, parsed: msg.parsed_output };
  };

  return {
    model: config.extractModel,
    promptVersion: PROMPT_VERSION,
    async extract(doc) {
      const run = await withCallCapture(() => call(doc));
      const { calls } = run;
      // The SDK parses before returning, so a refusal or truncation surfaces as a parse error;
      // the gateway's metrics carry the stop reason either way. Check it before using output.
      const stopReason = run.ok ? run.value.stopReason : calls.at(-1)?.stopReason;
      if (calls.length === 0) {
        if (!run.ok) throw run.error; // no response at all (network, replay miss): unchanged
        throw new Error(
          "No LLM call metrics captured: build the client with onCall: captureLlmCall.",
        );
      }
      if (stopReason === "refusal") {
        throw new ExtractionError("The model refused the extraction (stop_reason refusal).", calls);
      }
      if (stopReason === "max_tokens") {
        throw new ExtractionError("The extraction was truncated (stop_reason max_tokens).", calls);
      }
      if (!run.ok) {
        const message = run.error instanceof Error ? run.error.message : String(run.error);
        throw new ExtractionError(`Unusable extraction output: ${message}`, calls, {
          cause: run.error,
        });
      }
      if (stopReason !== "end_turn") {
        throw new ExtractionError(`Unexpected stop_reason ${String(stopReason)}.`, calls);
      }
      const parsed = ExtractionEnvelope.safeParse(run.value.parsed);
      if (!parsed.success) {
        throw new ExtractionError("The extraction output does not match ExtractionOutput.", calls);
      }
      return { output: parsed.data.extraction, metrics: calls };
    },
  };
}
