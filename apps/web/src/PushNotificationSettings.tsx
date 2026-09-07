import { useEffect, useState } from 'react';
import type { AccountNotificationApi, PushPreferences, PushState } from './account-notification-api';
import {
  browserPushCapability,
  currentBrowserPushSubscription,
  disableCurrentBrowserPush,
  enableBrowserPush,
  iosHomeScreenPushHint,
} from './browser-push';

type Props = {
  api: AccountNotificationApi;
  sessionToken: string;
  onSessionError: (cause: unknown) => boolean;
};

export function PushNotificationSettings({ api, sessionToken, onSessionError }: Props) {
  const [state, setState] = useState<PushState | null>(null);
  const [thisDeviceEnabled, setThisDeviceEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const capability = browserPushCapability();

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api.pushState(sessionToken),
      currentBrowserPushSubscription().catch(() => null),
    ]).then(([nextState, subscription]) => {
      if (!alive) return;
      setState(nextState);
      setThisDeviceEnabled(Boolean(subscription));
    }).catch((cause) => {
      if (!alive || onSessionError(cause)) return;
      setError(message(cause, '通知設定載入失敗'));
    });
    return () => { alive = false; };
  }, [api, sessionToken, onSessionError]);

  async function enablePush() {
    if (!state?.serverPushEnabled || !state.publicKey) {
      setError('目前尚未啟用推播服務，通知中心仍可正常使用。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const registration = await enableBrowserPush(state.publicKey);
      const nextState = await api.registerPushSubscription(sessionToken, registration);
      setState(nextState);
      setThisDeviceEnabled(true);
    } catch (cause) {
      if (!onSessionError(cause)) setError(pushErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    setBusy(true);
    setError(null);
    try {
      const current = await currentBrowserPushSubscription();
      if (current) {
        const nextState = await api.revokePushSubscription(sessionToken, current.endpoint);
        setState(nextState);
        await disableCurrentBrowserPush();
      }
      setThisDeviceEnabled(false);
    } catch (cause) {
      if (!onSessionError(cause)) setError(message(cause, '停用此裝置推播失敗'));
    } finally {
      setBusy(false);
    }
  }

  async function changePreference(key: keyof PushPreferences, enabled: boolean) {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const preferences = await api.updatePushPreferences(sessionToken, { [key]: enabled });
      setState((current) => current ? { ...current, preferences } : current);
    } catch (cause) {
      if (!onSessionError(cause)) setError(message(cause, '推播偏好更新失敗'));
    } finally {
      setBusy(false);
    }
  }

  return <section className="push-settings" aria-label="推播通知設定">
    <div className="push-settings-head">
      <div>
        <strong>推播通知</strong>
        <span>IN_APP 通知永遠保留；PUSH 是額外提醒。</span>
      </div>
      {thisDeviceEnabled ? <button className="ghost compact" disabled={busy} onClick={() => void disablePush()}>停用此裝置</button>
        : <button className="compact" disabled={busy || !state?.serverPushEnabled || capability !== 'SUPPORTED'} onClick={() => void enablePush()}>開啟通知</button>}
    </div>

    {capability === 'UNSUPPORTED' ? <p className="push-note">此瀏覽器目前不支援這組 Web Push 功能。{iosHomeScreenPushHint()}</p> : null}
    {capability === 'PERMISSION_DENIED' ? <p className="push-note">瀏覽器已拒絕通知權限；AFTERTRACE 仍會保留通知中心內容。若要重新開啟，請先到瀏覽器/系統設定調整權限。</p> : null}
    {state && !state.serverPushEnabled ? <p className="push-note">伺服器推播尚未完成設定；通知中心仍正常使用。</p> : null}
    {state ? <p className="push-device-count">此帳號目前有 {state.activeSubscriptionCount} 個啟用中的推播裝置/瀏覽器。</p> : null}
    {error ? <div className="notification-inline-error">{error}</div> : null}

    {state ? <div className="push-preferences">
      <PreferenceToggle
        label="公告通知"
        checked={state.preferences.announcementPushEnabled}
        disabled={busy}
        onChange={(checked) => void changePreference('announcementPushEnabled', checked)}
      />
      <PreferenceToggle
        label="系統通知"
        checked={state.preferences.systemPushEnabled}
        disabled={busy}
        onChange={(checked) => void changePreference('systemPushEnabled', checked)}
      />
      <PreferenceToggle
        label="待辦通知"
        checked={state.preferences.taskPushEnabled}
        disabled={busy}
        onChange={(checked) => void changePreference('taskPushEnabled', checked)}
      />
    </div> : null}
  </section>;
}

function PreferenceToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return <label className="push-preference-row">
    <span>{label}</span>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  </label>;
}

function pushErrorMessage(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : '';
  if (text === 'PUSH_PERMISSION_DENIED') return '未取得通知權限；AFTERTRACE 不會自動重複詢問，通知中心仍可正常使用。';
  if (text === 'PUSH_UNSUPPORTED') return `此瀏覽器不支援目前的 Web Push。${iosHomeScreenPushHint()}`;
  return message(cause, '推播啟用失敗');
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
