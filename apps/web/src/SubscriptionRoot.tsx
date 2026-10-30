import { useEffect, useState } from 'react';
import { clearLocalModelCache, localModelCacheInfo } from './model-cache';
import './worklog.css';

export function SubscriptionRoot({ apiBaseUrl: _apiBaseUrl }: { apiBaseUrl: string }) {
  const [info, setInfo] = useState('正在讀取快取狀態…');
  const [busy, setBusy] = useState(false);
  const refresh = async () => { try { const result = await localModelCacheInfo(); setInfo(result.files ? '已快取 ' + result.files + ' 個模型資源；目前瀏覽器儲存空間已使用約 ' + result.usedMiB + ' MB（含本站其他資料），可用約 ' + result.availableMiB + ' MB。' : '尚無模型快取；首次使用 AI 會下載模型。'); } catch { setInfo('此瀏覽器無法讀取模型快取狀態。'); } };
  useEffect(() => { void refresh(); }, []);
  async function clear() {
    if (busy || !window.confirm('清除本機模型快取？下次使用 AI 需重新下載。已保存的紀錄不受影響。')) return;
    setBusy(true);
    try { await clearLocalModelCache(); await refresh(); } catch (cause) { setInfo(cause instanceof Error ? cause.message : '清除失敗，請重試。'); } finally { setBusy(false); }
  }
  return <main className="shell worklog-shell"><section className="panel stack"><h1>本機 AI</h1>
    <p>所有 AI 使用你的裝置算力，不需要訂閱、付款或雲端 AI 點數。</p>
    <p>支援文字、圖片與短語音。模型約需數百 MB 至數 GB 空間，進入記錄頁即背景準備文字／圖片模型，語音模型於錄音功能使用時下載；下載時間取決於網路。圖片、錄音不傳到後端，只有你確認的文字會保存。</p>
    <h2>模型快取</h2><p role="status">{info}</p><button className="ghost" disabled={busy} onClick={() => void clear()}>{busy ? '清除中…' : '清除模型快取'}</button>
    <p>模型完成工作後會暫留記憶體，閒置 5 分鐘後釋放；瀏覽器也可能自動清除下載快取。不支援 WebGPU 時仍可手動保存。</p>
  </section></main>;
}
