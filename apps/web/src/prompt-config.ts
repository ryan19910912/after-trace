import seeds from "../../../config/local-ai-prompts.seed.json";
export type LocalPrompt = {
  key: string;
  template: string;
  maxTokens: number;
  version: number;
};
export async function publishedPrompts(
  _baseUrl?: string,
): Promise<LocalPrompt[]> {
  return seeds.map((p) => ({
    key: p.key,
    template: p.template,
    maxTokens: p.maxTokens,
    version: 1,
  }));
}
export function renderLocalPrompt(
  template: string,
  values: Record<string, string>,
) {
  return template.replace(
    /\{\{\s*([a-zA-Z]\w*)\s*\}\}/g,
    (_match, name: string) => {
      if (!Object.prototype.hasOwnProperty.call(values, name))
        throw Error("AI 設定缺少必要變數。");
      return values[name];
    },
  );
}
export async function configuredPrompt(
  key: string,
  values: Record<string, string>,
  baseUrl?: string,
  snapshot?: LocalPrompt[],
) {
  const prompt = (snapshot ?? (await publishedPrompts(baseUrl))).find(
    (p) => p.key === key,
  );
  if (!prompt) throw Error("找不到本機 AI 提示設定。");
  return {
    prompt: renderLocalPrompt(prompt.template, values),
    maxNewTokens: prompt.maxTokens,
  };
}
