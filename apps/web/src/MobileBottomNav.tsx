type NavItem = {
  href: string;
  label: string;
  icon: string;
  active: (path: string) => boolean;
};

const items: NavItem[] = [
  { href: '/', label: '紀錄', icon: '▤', active: (path) => path === '/' },
  { href: '/tasks', label: '待辦', icon: '✓', active: (path) => path.startsWith('/tasks') },
  { href: '/ai-search', label: 'AI 搜尋', icon: '⌕', active: (path) => path === '/ai-search' },
  { href: '/subscription', label: '方案', icon: '◇', active: (path) => path === '/subscription' },
];

export function MobileBottomNav() {
  const path = typeof window === 'undefined' ? '/' : window.location.pathname;
  return <nav className="mobile-bottom-nav" aria-label="主要導覽">
    {items.map((item) => <a
      key={item.href}
      href={item.href}
      className={item.active(path) ? 'active' : ''}
      aria-current={item.active(path) ? 'page' : undefined}
    >
      <span className="mobile-bottom-nav-icon" aria-hidden="true">{item.icon}</span>
      <span>{item.label}</span>
    </a>)}
  </nav>;
}
