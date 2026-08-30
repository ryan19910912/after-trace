import { z } from 'zod';
import type { AiTokenUsage } from '../ai/cost';
import type { MemoryClassificationInput } from './classification-input';
import type { ClassifiedMemoryCandidate } from './pipeline';

const memoryDecisionSchema = z.enum(['NEW', 'DUPLICATE', 'UPDATE', 'CONTRADICT']);

export const memoryClassifierCandidateSchema = z
  .object({
    candidateIndex: z.number().int().nonnegative(),
    decision: memoryDecisionSchema,
    targetMemoryId: z.number().int().positive().nullable(),
    category: z.string().trim().min(1).max(64),
    subject: z.string().trim().min(1).max(200).nullable(),
    content: z.string().trim().min(1).max(4_000),
    sourceConversationMessageId: z.number().int().positive(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.decision === 'NEW' && candidate.targetMemoryId !== null) {
      context.addIssue({ code: 'custom', path: ['targetMemoryId'], message: 'NEW candidate must not target an existing memory' });
    }
    if (candidate.decision !== 'NEW' && candidate.targetMemoryId === null) {
      context.addIssue({ code: 'custom', path: ['targetMemoryId'], message: `${candidate.decision} candidate must target an active memory` });
    }
  });

export const memoryClassifierOutputSchema = z
  .object({
    need_save: z.boolean(),
    candidates: z.array(memoryClassifierCandidateSchema).max(20),
  })
  .strict()
  .superRefine((output, context) => {
    if (!output.need_save && output.candidates.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'need_save=false requires an empty candidates array',
      });
    }
    if (output.need_save && output.candidates.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'need_save=true requires at least one candidate',
      });
    }
    output.candidates.forEach((candidate, index) => {
      if (candidate.candidateIndex !== index) {
        context.addIssue({ code: 'custom', path: ['candidates', index, 'candidateIndex'], message: 'candidateIndex must equal its array index' });
      }
    });
  });

export type MemoryClassifierOutput = z.infer<typeof memoryClassifierOutputSchema>;

export type MemoryClassifierResponse = {
  output: MemoryClassifierOutput;
  tokenUsage: AiTokenUsage;
  model: string;
  providerResponseId?: string | null;
  latencyMs: number | null;
};

export interface MemoryClassifierPort {
  classify(input: MemoryClassificationInput): Promise<MemoryClassifierResponse>;
}

export function parseMemoryClassifierOutput(
  raw: unknown,
  input: MemoryClassificationInput,
): ClassifiedMemoryCandidate[] {
  const parsed = memoryClassifierOutputSchema.parse(raw);
  if (!parsed.need_save) return [];

  const sourceMessages = new Map(input.currentMessages.map((message) => [message.id, message]));
  const activeMemoryIds = new Set(input.activeMemories.map((memory) => memory.id));
  const eligibleSubjects = new Set(input.eligibleSubjectLineUserIds);

  for (const candidate of parsed.candidates) {
    const source = sourceMessages.get(candidate.sourceConversationMessageId);
    if (!source) {
      throw new Error(`classifier candidate ${candidate.candidateIndex} referenced a source outside the current request`);
    }
    if (
      input.origin === 'AUTOMATIC' &&
      (!source.lineUserId || !eligibleSubjects.has(source.lineUserId))
    ) {
      throw new Error(
        `classifier candidate ${candidate.candidateIndex} referenced an ineligible automatic-memory subject`,
      );
    }
    if (candidate.targetMemoryId !== null && !activeMemoryIds.has(candidate.targetMemoryId)) {
      throw new Error(`classifier candidate ${candidate.candidateIndex} referenced a non-active target memory`);
    }
  }
  return parsed.candidates;
}
