import type { MemoryClassificationInput } from './classification-input';

export type MemoryClassifierPrompt = {
  systemInstruction: string;
  userPrompt: string;
};

export function buildMemoryClassifierPrompt(input: MemoryClassificationInput): MemoryClassifierPrompt {
  const currentSourceIds = input.currentMessages.map((message) => message.id);
  const speakerAliases = buildSpeakerAliases(input);

  const systemInstruction = [
    'You are AFTERTRACE memory classification for one LINE group.',
    'Return only structured candidates that are likely to be useful later.',
    'Every candidate decision must be NEW, DUPLICATE, UPDATE, or CONTRADICT.',
    'Only currentMessages may be used as sourceConversationMessageId.',
    'previousContext is context only and must never be cited as a new source.',
    'DUPLICATE, UPDATE, and CONTRADICT may target only ids listed in activeMemories.',
    'NEW must use targetMemoryId=null.',
    'candidateIndex must start at 0 and equal the candidate array position.',
    'Do not infer sensitive facts that are not stated in the supplied conversation.',
  ].join(' ');

  const payload = {
    request: {
      requestId: input.requestId,
      origin: input.origin,
      instruction: input.instruction,
      allowedSourceConversationMessageIds: currentSourceIds,
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
