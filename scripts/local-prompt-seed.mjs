// Seed once. Existing operator edits and published versions are never overwritten.
export function promptSeedStatements(definitions) {
  const q = value => "'" + String(value).replaceAll("'", "''") + "'";
  return definitions.map(spec => `WITH seeded AS (INSERT INTO worklog_local_ai_prompts(key,draft_template,published_template,draft_max_tokens,published_max_tokens,updated_by,published_by) VALUES (${q(spec.key)},${q(spec.template)},${q(spec.template)},${Number(spec.maxTokens)},${Number(spec.maxTokens)},'initial-seed','initial-seed') ON CONFLICT(key) DO NOTHING RETURNING *) INSERT INTO worklog_local_ai_prompt_revisions(prompt_key,action,version,template,max_tokens,actor) SELECT key,'SEEDED',version,published_template,published_max_tokens,'initial-seed' FROM seeded;`);
}
