export type AiToolsDeepLink = {
  sourceId: number;
  recordId: number;
  tool: 'related' | 'rewrite';
};

const ALLOWED_KEYS = new Set(['sourceId', 'recordId', 'tool']);

/**
 * Parses only bounded same-page AI-tools navigation state.
 * The URL never grants authorization; backend Source/Record authorization remains mandatory.
 */
export function aiToolsDeepLinkFromSearch(search: string): AiToolsDeepLink | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  if ([...params.keys()].some((key) => !ALLOWED_KEYS.has(key))) return null;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) return null;

  const sourceId = positiveId(params.get('sourceId'));
  const recordId = positiveId(params.get('recordId'));
  const tool = params.get('tool');
  if (!sourceId || !recordId || (tool !== 'related' && tool !== 'rewrite')) return null;
  return { sourceId, recordId, tool };
}

export function aiToolsDeepLinkUrl(input: AiToolsDeepLink): string {
  const sourceId = positiveId(String(input.sourceId));
  const recordId = positiveId(String(input.recordId));
  if (!sourceId || !recordId || (input.tool !== 'related' && input.tool !== 'rewrite')) {
    throw new Error('INVALID_AI_TOOLS_DEEP_LINK');
  }
  const params = new URLSearchParams({
    sourceId: String(sourceId),
    recordId: String(recordId),
    tool: input.tool,
  });
  return `/ai-tools?${params.toString()}`;
}

function positiveId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
