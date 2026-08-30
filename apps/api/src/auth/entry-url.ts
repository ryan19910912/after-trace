import { createAuthNonce, issueWebEntryToken } from './token';

export async function buildGroupWebEntryUrl(input: {
  webAppUrl: string;
  lineUserId: string;
  lineGroupId: string;
  secret: string;
  now?: Date;
}): Promise<string> {
  const url = new URL(input.webAppUrl);
  url.searchParams.set('t', await issueWebEntryToken({
    lineUserId: input.lineUserId,
    lineGroupId: input.lineGroupId,
    nonce: createAuthNonce(),
    secret: input.secret,
    now: input.now,
  }));
  return url.toString();
}
