/**
 * Phase 3.5 triage tool factory.
 *
 * `buildTriageTools(ctx)` returns the read-only tool set that the Gemini
 * classifier may invoke during the bounded tool loop in `triageTicket.ts`.
 * The factory closes over the ticket's `ticketId`, `orgId`, `userId`,
 * `subject`, and `description`, so the agent cannot inject any of them via
 * tool arguments — the `inputSchema` for both tools deliberately exposes
 * only `limit`.
 *
 * Two tools ship in this phase:
 *
 *   - `findSimilarTicketsForContext` — embeds the (subject + description)
 *     once per `buildTriageTools(ctx)` invocation, then asks the
 *     `find_similar_tickets` RPC for the top-K nearest org-bound matches
 *     within the per-org dedup window. The cosine threshold is the looser
 *     `CONTEXT_SIMILARITY_THRESHOLD` (not the dedup threshold) — see
 *     `services/features/triage/config.ts` for the rationale. The same RPC
 *     powers vector dedup, but this surface is strictly read-only and
 *     commits nothing.
 *
 *   - `getRecentUserTickets` — returns the submitter's most recent tickets
 *     (newest-first, soft-delete filtered) so the model can spot
 *     user-pattern recurrence.
 *
 * Tool outputs use shallow, hashed-down shapes (no full descriptions, no
 * PII other than what the model already has) — both to limit the prompt
 * bloat and to keep what the model sees consistent with what we record in
 * the audit log.
 *
 * `summarizeSteps` lives here too: it walks the SDK `StepResult[]` from a
 * `generateText` call and produces the `{ name, input, durationMs, ok }`
 * shape that `triageTicket.ts` writes to `ticket_events.triaged.payload.tool_calls`.
 * Outputs are intentionally not serialized.
 */

import { tool, type StepResult, type ToolSet } from 'ai';
import { z } from 'zod';

import { ai } from '@/services/providers/ai';
import { server as sources } from '@/services/providers/supabase/server';
import {
  CONTEXT_SIMILARITY_THRESHOLD,
} from '@/services/features/triage/config';
import { DEFAULT_DEDUP_WINDOW_DAYS } from '@/services/features/dedup/config';

export type TriageToolContext = {
  ticketId: string;
  orgId: string;
  userId: string;
  subject: string;
  description: string;
};

const DEFAULT_LIMIT = 5;

const LimitSchema = z.object({
  limit: z.number().int().min(1).max(20).optional(),
});

export function buildTriageTools(ctx: TriageToolContext): ToolSet {
  // Memoized within a single invocation: the model may call the similar-
  // tickets tool more than once across rounds; re-embedding the same
  // subject+description would burn extra OpenAI calls.
  let embedPromise: Promise<number[]> | null = null;
  const getEmbedding = () => {
    if (!embedPromise) {
      embedPromise = ai.generateEmbedding(`${ctx.subject}\n${ctx.description}`);
    }
    return embedPromise;
  };

  // Read window once per build; re-reading per call would add a DB
  // round-trip to every tool invocation without changing semantics — the
  // window is org-level state, not per-request state.
  let windowPromise: Promise<number> | null = null;
  const getWindowDays = () => {
    if (!windowPromise) {
      windowPromise = sources.orgSettings
        .getByOrg({ orgId: ctx.orgId })
        .then((settings) => settings?.dedup_window_days ?? DEFAULT_DEDUP_WINDOW_DAYS)
        .catch(() => DEFAULT_DEDUP_WINDOW_DAYS);
    }
    return windowPromise;
  };

  return {
    findSimilarTicketsForContext: tool({
      description:
        'Return up to `limit` past tickets in this org whose description is semantically close to the current ticket. Use to ground classification when the subject or description is ambiguous. Read-only; results are advisory, not exhaustive.',
      inputSchema: LimitSchema,
      execute: async ({ limit }) => {
        const k = limit ?? DEFAULT_LIMIT;
        const [queryEmbedding, windowDays] = await Promise.all([
          getEmbedding(),
          getWindowDays(),
        ]);

        const hits = await sources.dedupSignatures.findSimilarTickets({
          orgId: ctx.orgId,
          queryEmbedding,
          windowDays,
          similarityThreshold: CONTEXT_SIMILARITY_THRESHOLD,
          // Ask for one extra candidate so filtering the current ticket out
          // does not reduce the context window when the current ticket was
          // already embedded by Phase 3 dedup.
          limit: k + 1,
        });

        const hydrated = await Promise.all(
          hits
            .filter((hit) => hit.ticketId !== ctx.ticketId)
            .map((hit) =>
              sources.tickets
                .getById({ orgId: ctx.orgId, ticketId: hit.ticketId })
                .then((row) => (row ? { row, similarity: hit.similarity } : null)),
            ),
        );

        return hydrated
          .filter((entry): entry is { row: NonNullable<typeof entry>['row']; similarity: number } => entry !== null)
          .slice(0, k)
          .map(({ row, similarity }) => ({
            ticketId: row.id,
            similarity,
            type: row.type,
            severity: row.severity,
            status: row.status,
            subjectPreview: row.subject.slice(0, 120),
          }));
      },
    }),

    getRecentUserTickets: tool({
      description:
        "Return up to `limit` of this submitter's most recent tickets (newest first, soft-deleted excluded). Use to spot recurring incidents tied to one user. Read-only.",
      inputSchema: LimitSchema,
      execute: async ({ limit }) => {
        const k = limit ?? DEFAULT_LIMIT;
        const rows = await sources.tickets.listByUser({
          orgId: ctx.orgId,
          userId: ctx.userId,
          // The current ticket is usually the newest row for this user; ask
          // for one extra and filter it out so the tool returns history.
          limit: k + 1,
        });
        return rows
          .filter((row) => row.id !== ctx.ticketId)
          .slice(0, k)
          .map((row) => ({
            ticketId: row.id,
            createdAt: row.created_at,
            type: row.type,
            severity: row.severity,
            status: row.status,
            subjectPreview: row.subject.slice(0, 120),
          }));
      },
    }),
  };
}

export type ToolCallAudit = {
  name: string;
  input: unknown;
  durationMs: number;
  ok: boolean;
};

/**
 * Walk `StepResult[]` from a tool-loop run and produce one audit entry per
 * tool call. Pairing is by `toolCallId`: each call lives on `step.toolCalls`,
 * each completion on the same (or a later) step's `toolResults` /
 * `toolErrors`. The final-step assistant text and tool *outputs* are not
 * serialized — see the Phase 3.5 plan for the no-output-recording policy.
 *
 * `durationMs` is best-effort: the SDK does not surface per-call timing, so
 * we record `0` for synchronously-completed calls. If a future SDK release
 * exposes timing data, slot it in here without touching the audit shape.
 */
export function summarizeSteps(steps: StepResult<ToolSet>[]): ToolCallAudit[] {
  const audits: ToolCallAudit[] = [];

  // Build a lookup of toolCallId -> { ok }. A call with a matching result
  // (any output) is ok; a call with a matching error is not. The two arrays
  // are populated by the SDK as the loop progresses, so we must walk every
  // step before deciding whether each call succeeded.
  const outcome = new Map<string, boolean>();
  for (const step of steps) {
    for (const result of step.toolResults) {
      outcome.set(result.toolCallId, true);
    }
    for (const content of step.content) {
      if (content.type === 'tool-error') {
        outcome.set(content.toolCallId, false);
      }
    }
  }

  for (const step of steps) {
    for (const call of step.toolCalls) {
      audits.push({
        name: call.toolName,
        input: call.input,
        durationMs: 0,
        ok: outcome.get(call.toolCallId) ?? false,
      });
    }
  }

  return audits;
}
