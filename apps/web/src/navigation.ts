const routes = new Set(['/', '/capture', '/tasks', '/ai-search', '/ai-tools', '/ai-task', '/subscription', '/feedback', '/help', '/about', '/mobile-shortcut', '/worklog']);
export function installNavigation(onNavigate: () => void): () => void {
  let previous = location.pathname + location.search;
  const pop = () => {
    if (!window.dispatchEvent(new Event('aftertrace:before-navigate', { cancelable: true }))) { history.pushState({}, '', previous); return; }
    previous = location.pathname + location.search; onNavigate();
  };
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (!link || link.target || link.hasAttribute('download') || link.getAttribute('rel')?.includes('external')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !routes.has(url.pathname) || url.hash || url.searchParams.has('session')) return;
    if (url.pathname + url.search === location.pathname + location.search) { event.preventDefault(); return; }
    const guard = new Event('aftertrace:before-navigate', { cancelable: true });
    if (!window.dispatchEvent(guard)) { event.preventDefault(); return; }
    event.preventDefault(); history.pushState({}, '', url.pathname + url.search); previous = url.pathname + url.search; onNavigate();
  };
  document.addEventListener('click', click); window.addEventListener('popstate', pop);
  return () => { document.removeEventListener('click', click); window.removeEventListener('popstate', pop); };
}
