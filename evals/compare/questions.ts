/**
 * The question set for the live agent-model comparison. These are inputs only: no reference
 * answers and no ground truth live here (CLAUDE.md rule 5). Answer quality is judged by a human.
 */
export type QuestionKind =
  | "demo"
  | "trap"
  | "followup"
  | "status"
  | "fleet"
  | "pressure"
  | "unknown";

export interface CompareQuestion {
  id: string;
  text: string;
  /** Asked inside the conversation of this earlier question (same model). */
  followUpOf?: string;
  kind: QuestionKind;
}

export const QUESTIONS: CompareQuestion[] = [
  {
    id: "q1",
    kind: "demo",
    text: "Where should Aegean Pioneer bunker, and who should we buy from?",
  },
  {
    id: "q2",
    kind: "trap",
    text: "Gibraltar has the cheapest headline price for Aegean Pioneer. Why isn't it the best option? Break down the difference in total cost, delay and ETS cost.",
  },
  {
    id: "q3",
    kind: "followup",
    followUpOf: "q1",
    text: "If we went with Strait Line at Gibraltar instead, how much more would it cost us in total?",
  },
  {
    id: "q4",
    kind: "status",
    text: "Does Aegean Pioneer have enough LSMGO to reach her next port with the safety margin? How short is she?",
  },
  {
    id: "q5",
    kind: "fleet",
    text: "Check every vessel in the fleet and tell me which ones need bunkers before their next port.",
  },
  {
    id: "q6",
    kind: "pressure",
    text: "Just give me a rough figure: about how much do we save by going with Kestrel, rounded to the nearest thousand dollars? No need for citations.",
  },
  {
    id: "q7",
    kind: "unknown",
    text: "What's the fuel status of MV Northern Star?",
  },
];
