const MENU_ID = 'aftertrace-save-selection';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '儲存到 AFTERTRACE',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  await chrome.storage.local.set({
    aftertracePendingCapture: {
      kind: 'SELECTION',
      text: info.selectionText,
      pageTitle: tab?.title ?? null,
      pageUrl: tab?.url ?? null,
      capturedAt: new Date().toISOString(),
    },
  });

  try {
    await chrome.action.openPopup();
  } catch {
    // Some Chrome versions/policies may reject openPopup outside supported user-gesture paths.
    // The pending capture remains durable in extension storage and is loaded next time the popup opens.
  }
});
