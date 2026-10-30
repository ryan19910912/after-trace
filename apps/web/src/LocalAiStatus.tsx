import { useEffect, useState } from 'react';
import { cancelLocalAi, subscribeLocalAiStatus } from './local-ai';

export function LocalAiStatus({ onCancel }: { onCancel?: () => void } = {}) {
  const [status, setStatus] = useState('');
  useEffect(() => {
    const unsubscribe = subscribeLocalAiStatus(setStatus);
    return () => { unsubscribe(); cancelLocalAi(); };
  }, []);
  if (!status) return null;
  return <section className="panel local-ai-status" aria-label="本機 AI 處理狀態"><p role="status" aria-live="polite">{status}</p><button className="ghost" onClick={() => { onCancel?.(); cancelLocalAi(); }}>取消 AI 處理</button></section>;
}
