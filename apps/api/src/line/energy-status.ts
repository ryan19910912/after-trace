export type GroupEnergyMemberStatus = {
  displayName: string;
  usable: boolean;
};

export function formatGroupEnergyStatus(
  members: readonly GroupEnergyMemberStatus[],
  liffAppUrl: string,
  callerExhausted = false,
): string {
  const url = liffAppUrl.trim();
  if (!url) throw new Error('LIFF_APP_URL is required for Energy status replies');
  const rows = members.map(
    (member) => `${member.usable ? '🟢' : '🔴'} ${member.displayName}　${member.usable ? '可使用' : '額度已用完'}`,
  );
  return [
    ...(callerExhausted ? ['你的 AFTERTRACE Energy 已用完。', ''] : []),
    'AFTERTRACE｜群組 Energy',
    '',
    ...rows,
    '',
    '想查看自己的詳細 Energy、訂閱、購買 Energy 或觀看廣告，可開啟 AFTERTRACE：',
    url,
  ].join('\n');
}
