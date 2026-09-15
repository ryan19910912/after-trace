import { useState, type ReactNode } from 'react';

const SESSION_KEY = 'aftertrace.admin.session';

const navItems = [
  { href: '/', label: '總覽', icon: '⌂', active: (path: string) => path === '/' },
  { href: '/accounts', label: '帳號查詢', icon: 'ID', active: (path: string) => path === '/accounts' },
  { href: '/commercial', label: '商業方案', icon: '◇', active: (path: string) => path === '/commercial' || path === '/pricing-calculator' },
  { href: '/ai-runtime', label: '模型與價格', icon: 'AI', active: (path: string) => path === '/ai-runtime' },
  { href: '/profitability', label: '獲利分析', icon: '↗', active: (path: string) => path === '/profitability' },
  { href: '/announcements', label: '公告管理', icon: '◉', active: (path: string) => path === '/announcements' },
  { href: '/feedback-management', label: '意見回饋', icon: '✦', active: (path: string) => path === '/feedback-management' },
];

export function AdminAppChrome({ children }: { children: ReactNode }) {
  const path = window.location.pathname;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = '/';
  }

  const navigation = <nav className="admin-sidebar-nav">
    {navItems.map((item) => <a key={item.href} href={item.href} className={item.active(path) ? 'active' : ''} aria-current={item.active(path) ? 'page' : undefined}>
      <span className="admin-nav-icon" aria-hidden="true">{item.icon}</span>
      <span>{item.label}</span>
    </a>)}
  </nav>;

  return <div className="admin-app-shell">
    <aside className="admin-sidebar" aria-label="AFTERTRACE 管理後台導覽">
      <a className="admin-sidebar-brand" href="/" aria-label="AFTERTRACE 管理後台首頁">
        <img src="/aftertrace-icon.svg" alt="" />
        <div><strong>AFTERTRACE</strong><span>ADMIN</span></div>
      </a>
      {navigation}
      <div className="admin-sidebar-footer">
        <div><span>SYSTEM ENV</span><strong>FREE + AI Pro</strong></div>
        <button className="ghost" onClick={logout}>登出</button>
      </div>
    </aside>

    <header className="admin-mobile-bar">
      <button className="admin-mobile-menu-trigger ghost" type="button" aria-label="開啟管理選單" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((value) => !value)}>
        <span aria-hidden="true">☰</span>
      </button>
      <a className="admin-sidebar-brand" href="/"><img src="/aftertrace-icon.svg" alt="" /><div><strong>AFTERTRACE</strong><span>ADMIN</span></div></a>
      <button className="ghost admin-mobile-logout" onClick={logout}>登出</button>
    </header>

    {mobileMenuOpen ? <div className="admin-mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)}>
      <aside className="admin-mobile-menu" aria-label="AFTERTRACE 管理後台行動版導覽" onClick={(event) => event.stopPropagation()}>
        <div className="admin-mobile-menu-head"><strong>管理選單</strong><button className="ghost" aria-label="關閉管理選單" onClick={() => setMobileMenuOpen(false)}>×</button></div>
        {navigation}
      </aside>
    </div> : null}

    <main className="admin-app-content">{children}</main>
  </div>;
}
