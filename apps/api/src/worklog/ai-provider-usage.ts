export type WorklogAiUsageCommit = {
  workspaceId?: number | null;
  recordId?: number | null;
  operation?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  audioInputUnits?: number;
  imageInputUnits?: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  audioUsdPerMillion?: number | null;
  imageUsdPerMillion?: number | null;
  usdTwdRate?: number | null;
  providerCostUsd: number;
  providerCostTwd?: number | null;
};
