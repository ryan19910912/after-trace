import type { MemoryClassificationInput } from './classification-input';

export type MemoryClassifierPrompt = {
  systemInstruction: string;
  userPrompt: string;
};

export function buildMemoryClassifierPrompt(input: MemoryClassificationInput): MemoryClassifierPrompt {
  const currentSourceIds = input.currentMessages.map((message) => message.id);
  const speakerAliases = buildSpeakerAliases(input);
  const eligibleAliases = input.eligibleSubjectLineUserIds
    .map((lineUserId) => speakerAliases.get(lineUserId))
    .filter((value): value is string => Boolean(value));

  const automaticBoundary = input.origin === 'AUTOMATIC'
    ? [
        'This is passive background memory extraction. Default to need_save=false.',
        'Only set need_save=true for information that is likely to remain useful weeks or months later, such as durable preferences, confirmed plans or decisions, commitments, meaningful relationship facts, recurring needs, or events the group is likely to ask about later.',
        'Do not save ordinary banter, temporary moods, casual reactions, jokes, routine status updates, or facts that are unlikely to matter later.',
        'Prefer missing a marginal memory over creating low-value memory.',
        'The complete group conversation may be used as context.',
        'However, durable memory candidates may only be about eligibleSubjectSpeakers.',
        'Every AUTOMATIC candidate sourceConversationMessageId must be authored by an eligibleSubjectSpeaker.',
        'Messages from other speakers are context only and must not create, update, or contradict durable facts about them.',
      ].join(' ')
    : [
        'This is an explicit capture request from the user.',
        'The caller has already decided that the supplied source should be remembered, so do not apply the conservative automatic-memory gate.',
        'Set need_save=true whenever the source and instruction contain enough information to create or reconcile at least one grounded memory.',
        'Follow the caller instruction and the resolved source message. Preserve concrete itinerary dates, times, places, reservations, preferences, and other details when they are present.',
      ].join(' ');

  const systemInstruction = [
    'You are AFTERTRACE memory classification for one LINE group.',
    'Return JSON only.',
    'If nothing should be persisted, return need_save=false and candidates=[].',
    'If something should be persisted, return need_save=true and one or more structured candidates.',
    'Every candidate decision must be NEW, DUPLICATE, UPDATE, or CONTRADICT.',
    'Only currentMessages may be used as sourceConversationMessageId.',
    'previousContext is context only and must never be cited as a new source.',
    'DUPLICATE, UPDATE, and CONTRADICT may target only ids listed in activeMemories.',
    'NEW must use targetMemoryId=null.',
    'candidateIndex must start at 0 and equal the candidate array position.',
    'Do not infer sensitive facts that are not stated in the supplied conversation.',
    'When a newer statement changes an existing plan or fact, prefer UPDATE or CONTRADICT over creating a second conflicting memory.',
    automaticBoundary,
  ].join(' ');

  const payload = {
    request: {
      requestId: input.requestId,
      origin: input.origin,
      instruction: input.instruction,
      allowedSourceConversationMessageIds: currentSourceIds,
      eligibleSubjectSpeakers: eligibleAliases,
    },
    currentMessages: input.currentMessages.map((message) =>
      toPromptMessage(message, speakerAliases),
    ),
    previousContext: input.previousContext
      ? {
          batchId: input.previousContext.batchId,
          messages: input.previousContext.messages.map((message) =>
            toPromptMessage(message, speakerAliases),
          ),
        }
      : null,
    activeMemories: input.activeMemories.map((memory) => ({
      id: memory.id,
      category: memory.category,
      subject: memory.subject,
      content: memory.content,
    })),
  };

  return { systemInstruction, userPrompt: JSON.stringify(payload) };
}

function buildSpeakerAliases(input: MemoryClassificationInput): Map<string, string> {
  const aliases = new Map<string, string>();
  const messages = [
    ...input.currentMessages,
    ...(input.previousContext?.messages ?? []),
  ];
  for (const message of messages) {
    if (!message.lineUserId || aliases.has(message.lineUserId)) continue;
    aliases.set(message.lineUserId, `speaker-${aliases.size + 1}`);
  }
  return aliases;
}

function toPromptMessage(
  message: MemoryClassificationInput['currentMessages'][number],
  speakerAliases: Map<string, string>,
) {
  return {
    id: message.id,
    speaker: message.lineUserId ? (speakerAliases.get(message.lineUserId) ?? null) : null,
    messageType: message.messageType,
    textContent: message.textContent,
    quotedLineMessageId: message.quotedLineMessageId,
    lineTimestamp: message.lineTimestamp.toISOString(),
    metadata: message.metadata,
  };
}
