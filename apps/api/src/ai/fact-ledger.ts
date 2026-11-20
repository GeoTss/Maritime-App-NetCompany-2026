/**
 * The conversation fact ledger: every fact a tool returned earlier in a conversation. The agent
 * seeds each ask's ledger with them, so an answer may cite, and `calculate` may combine, any fact
 * an earlier turn produced. Facts are read back from the stored tool messages, never rebuilt.
 */
import type { Sql } from "@pharos/db";
import { Fact, type Id } from "@pharos/shared";

interface StoredToolMessage {
  content: { isError?: boolean; result?: { facts?: unknown[] } } | null;
}

/**
 * The facts of every successful earlier tool result in the conversation, in call order (a fact
 * returned twice appears twice; the ledger keeps the later). Failed calls carry no facts, and a
 * stored fact that no longer parses is left out, so citing it fails the release gate.
 */
export async function loadConversationFacts(sql: Sql, conversationId: Id): Promise<Fact[]> {
  const rows = await sql<StoredToolMessage[]>`
    select content from messages
    where conversation_id = ${conversationId} and role = 'tool'
    order by id`;
  const facts: Fact[] = [];
  for (const { content } of rows) {
    if (content?.isError !== false) continue;
    for (const raw of content.result?.facts ?? []) {
      const parsed = Fact.safeParse(raw);
      if (parsed.success) facts.push(parsed.data);
    }
  }
  return facts;
}
