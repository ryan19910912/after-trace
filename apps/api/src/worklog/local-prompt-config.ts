import definitions from '../../../../config/local-ai-prompts.seed.json';
export { definitions as localPromptDefinitions };
export function promptDefinition(key: string) { return definitions.find((item) => item.key === key); }
export function validatePrompt(key: string, template: unknown, maxTokens: unknown): string | null {
  const spec = promptDefinition(key);
  if (!spec) return 'UNKNOWN_PROMPT';
  if (typeof template !== 'string' || !template.trim() || template.length > 4000) return 'TEMPLATE_LENGTH_INVALID';
  if (!Number.isSafeInteger(maxTokens) || Number(maxTokens) < 64 || Number(maxTokens) > 768) return 'MAX_TOKENS_INVALID';
  const variables = [...template.matchAll(/\{\{\s*([a-zA-Z]\w*)\s*\}\}/g)].map((match) => match[1]);
  if (spec.variables.some((name) => !variables.includes(name))) return 'REQUIRED_VARIABLE_MISSING';
  if (variables.some((name) => !spec.variables.includes(name)) || template.replace(/\{\{\s*[a-zA-Z]\w*\s*\}\}/g, '').includes('{{')) return 'UNKNOWN_VARIABLE';
  if (spec.outputFields.some((field) => !template.includes(`"${field}"`))) return 'OUTPUT_FIELDS_MISSING';
  return null;
}
