export type AiTaskDeepLink = {
  sourceId: number;
  recordId: number;
};

const ALLOWED_KEYS = new Set(['sourceId', 'recordId']);

/**
 * Parses only bounded same-page AI Task proposal navigation state.
 * URL parameters never grant access; backend Source/Record authorization remains authoritative.
 */
export function aiTaskDeepLinkFromSearch(search: string): AiTaskDeepLink | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  if ([...params.keys()].some((key) => !ALLOWED_KEYS.has(key))) return null;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) return null;
  const sourceId = positiveId(params.get('sourceId'));
  const recordId = positiveId(params.get('recordId'));
  return sourceId && recordId ? { sourceId, recordId } : null;
}

export function aiTaskDeepLinkUrl(input: AiTaskDeepLink): string {
  const sourceId = positiveId(String(input.sourceId));
  const recordId = positiveId(String(input.recordId));
  if (!sourceId || !recordId) throw new Error('INVALID_AI_TASK_DEEP_LINK');
  const params = new URLSearchParams({ sourceId: String(sourceId), recordId: String(recordId) });
  return `/ai-task?${params.toString()}`;
}

function positiveId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
