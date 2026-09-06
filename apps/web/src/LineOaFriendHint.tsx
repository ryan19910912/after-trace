import { useCallback, useEffect, useState } from 'react';
import './line-oa-friend-hint.css';

const SESSION_KEY = 'aftertrace.worklog.session';

type Props = { apiBaseUrl: string };

type SurfaceResponse = {
  ok?: boolean;
  surfaces?: {
    isOaFriend?: boolean;
  };
};

export function LineOaFriendHint({ apiBaseUrl }: Props) {
  const addUrl = import.meta.env.VITE_LINE_OA_ADD_URL?.trim();
  const qrImageUrl = import.meta.env.VITE_LINE_OA_QR_IMAGE_URL?.trim();
  const [isOaFriend, setIsOaFriend] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const refresh = useCallback(async () => {
    const callbackSession = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('session')?.trim() || null;
    const session = localStorage.getItem(SESSION_KEY) ?? callbackSession;
    if (!session) {
      setIsOaFriend(null);
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/worklog/surfaces`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!response.ok) return;
      const body = await response.json() as SurfaceResponse;
      if (typeof body.surfaces?.isOaFriend === 'boolean') {
        setIsOaFriend(body.surfaces.isOaFriend);
      }
    } catch {
      // This hint is optional. Never block Worklog when its refresh fails.
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  if (isOaFriend !== false || dismissed) return null;

  return <aside className="line-oa-hint" aria-label="LINE 快速使用提示">
    <button className="line-oa-hint-close" type="button" aria-label="關閉提示" onClick={() => setDismissed(true)}>×</button>
    <div className="line-oa-hint-copy">
      <p className="eyebrow">LINE 快速紀錄</p>
      <h2>想記得更快，也可以直接在 LINE 用 AFTERTRACE</h2>
      <p>你現在已經可以正常使用 Web 紀錄。加入 AFTERTRACE LINE 好友後，就能在聊天裡快速丟一句話，讓 AI 協助整理與記錄；不是使用 Web 的必要條件。</p>
      {addUrl ? <a className="line-oa-hint-action" href={addUrl} target="_blank" rel="noreferrer">加入 LINE 好友</a> : <p className="line-oa-hint-config">LINE 加好友入口尚未設定，不影響目前 Web 功能。</p>}
    </div>
    {qrImageUrl ? <div className="line-oa-hint-qr"><img src={qrImageUrl} alt="AFTERTRACE LINE 官方帳號加好友 QR Code" /><small>掃描 QR Code 加入好友</small></div> : null}
  </aside>;
}
