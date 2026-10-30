// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CaptureRoot } from './CaptureRoot';
import { organizeLocal, preloadLocalAi } from './local-ai';

vi.mock('./local-ai', async (original) => ({ ...await original<typeof import('./local-ai')>(), organizeLocal: vi.fn(), preloadLocalAi: vi.fn(async () => {}), cancelLocalAi: vi.fn() }));
const writes: RequestInit[] = [];
beforeEach(() => {
  localStorage.setItem('aftertrace.worklog.session', 'session');
  writes.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { writes.push(init); return Response.json({ record: { id: 1, sourceId: 1, rawText: '確認內容', version: 1 } }); }
    return Response.json({ surfaces: { personal: { sourceId: 1 }, groups: [{ sourceId: 2, name: '團隊', role: 'OWNER' }] } });
  }));
  vi.mocked(organizeLocal).mockResolvedValue({ title: 'AI 標題', rawText: 'AI 辨識內容', occurredAt: '' });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('local capture review and confirmation', () => {
  it('never saves on analysis; saves only edited text after explicit confirmation', async () => {
    render(<CaptureRoot apiBaseUrl="https://api.example.test" />);
    await screen.findByRole('option', { name: '我的紀錄' });
    fireEvent.change(screen.getByLabelText('輸入內容或貼上圖片'), { target: { value: '原始內容' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 解析' }));
    await screen.findByRole('heading', { name: '確認要保存的資訊' });
    expect(writes).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('內容'), { target: { value: '使用者修正的正確內容' } });
    fireEvent.click(screen.getByRole('button', { name: '確認保存' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(JSON.parse(String(writes[0].body))).toMatchObject({ rawText: '使用者修正的正確內容', title: 'AI 標題', occurredAt: null });
    expect(String(writes[0].body)).not.toContain('dataBase64');
  });
  it('allows manual review when local inference fails, without losing input', async () => {
    vi.mocked(organizeLocal).mockRejectedValue(new Error('此裝置無法使用本機 AI'));
    render(<CaptureRoot apiBaseUrl="https://api.example.test" />);
    await screen.findByRole('option', { name: '我的紀錄' });
    fireEvent.change(screen.getByLabelText('輸入內容或貼上圖片'), { target: { value: '保留這段文字' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 解析' }));
    await screen.findByRole('alert');
    expect(writes).toHaveLength(0);
    expect((screen.getByLabelText('輸入內容或貼上圖片') as HTMLTextAreaElement).value).toBe('保留這段文字');
    fireEvent.click(screen.getByRole('button', { name: '自行編輯草稿' }));
    expect((screen.getByLabelText('內容') as HTMLTextAreaElement).value).toBe('保留這段文字');
  });
  it('rejects pasted PDF and never invokes inference or saves it', async () => {
    render(<CaptureRoot apiBaseUrl="https://api.example.test" />);
    const file = new File(['pdf'], 'test.pdf', { type: 'application/pdf' });
    fireEvent.paste(screen.getByLabelText('輸入內容或貼上圖片'), { clipboardData: { files: [file] } });
    expect(screen.getByRole('alert').textContent).toContain('只接受');
    expect(organizeLocal).not.toHaveBeenCalled(); expect(writes).toHaveLength(0);
  });
  it('preserves edited review and prevents another analysis while reviewing', async () => {
    render(<CaptureRoot apiBaseUrl="https://api.example.test" />);
    fireEvent.change(screen.getByLabelText('輸入內容或貼上圖片'), { target: { value: '原文' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 解析' }));
    await screen.findByLabelText('內容');
    fireEvent.change(screen.getByLabelText('內容'), { target: { value: '修改後' } });
    expect(screen.queryByRole('button', { name: 'AI 解析' })).toBeNull();
    expect((screen.getByLabelText('內容') as HTMLTextAreaElement).value).toBe('修改後');
    expect((screen.getByLabelText('保存範圍') as HTMLSelectElement).disabled).toBe(true);
    expect(writes).toHaveLength(0);
  });
});


it('prefills explicit time during manual review and omits removed comparison sections', async () => {
  render(<CaptureRoot apiBaseUrl="https://api.example.test" />);
  await screen.findByRole('option', { name: '我的紀錄' });
  fireEvent.change(screen.getByLabelText('輸入內容或貼上圖片'), { target: { value: '晚上十點進行副本任務執行' } });
  fireEvent.click(screen.getByRole('button', { name: '自行編輯草稿' }));
  const field = screen.getByLabelText('發生時間（選填）') as HTMLInputElement;
  expect(field.value).toMatch(/T22:00$/); expect(screen.getByText(/未寫日期，以今天帶入/)).toBeTruthy();
  expect(screen.queryByText('對照原始內容')).toBeNull(); expect(screen.queryByText('查看文字變更（標示不同的區段）')).toBeNull();
  fireEvent.change(field, { target: { value: '2026-10-29T21:30' } });
  fireEvent.click(screen.getByRole('button', { name: '確認保存' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(JSON.parse(String(writes[0].body)).occurredAt).toBe(new Date('2026-10-29T21:30').toISOString());
});


it('starts background model preparation after authorized scope loads without an AI click or save', async () => {
  render(<CaptureRoot apiBaseUrl="https://api.example.test" />);
  await screen.findByRole('option', { name: '我的紀錄' });
  await waitFor(() => expect(preloadLocalAi).toHaveBeenCalledTimes(1));
  expect(organizeLocal).not.toHaveBeenCalled(); expect(writes).toHaveLength(0);
  await screen.findByText('本機 AI 已準備好。');
});
