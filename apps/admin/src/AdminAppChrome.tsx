import type { ReactNode } from 'react';

const SESSION_KEY = 'aftertrace.admin.session';

const navItems = [
  { href: '/', label: '總覽', icon: '⌂', active: (path: string) => path === '/' },
  { href: '/accounts', label: '帳號查詢', icon: 'ID', active: (path: string) => path === '/accounts' },
  { href: '/commercial', label: '商業方案', icon: '◇', active: (path: string) => path === '/commercial' },
  { href: '/pricing-calculator', label: '成本試算', icon: '∑', active: (path: string) => path === '/pricing-calculator' },
  { href: '/profitability', label: '獲利分析', icon: '↗', active: (path: string) => path === '/profitability' },
  { href: '/announcements', label: '公告管理', icon: '◉', active: (path: string) => path === '/announcements' },
  { href: '/feedback-management', label: '意見回饋', icon: '✦', active: (path: string) => path === '/feedback-management' },
];

export function AdminAppChrome({ children }: { children: ReactNode }) {
  const path = window.location.pathname;

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = '/';
  }

  return <div className="admin-app-shell">
    <aside className="admin-sidebar" aria-label="AFTERTRACE 管理後台導覽">
      <a className="admin-sidebar-brand" href="/" aria-label="AFTERTRACE 管理後台首頁">
        <img src="/aftertrace-icon.svg" alt="" />
        <div><strong>AFTERTRACE</strong><span>ADMIN</span></div>
      </a>

      <nav className="admin-sidebar-nav">
        {navItems.map((item) => <a key={item.href} href={item.href} className={item.active(path) ? 'active' : ''} aria-current={item.active(path) ? 'page' : undefined}>
          <span className="admin-nav-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </a>)}
      </nav>

      <div className="admin-sidebar-footer">
        <div><span>V1 PRELAUNCH</span><strong>FREE + AI Pro</strong></div>
        <button className="ghost" onClick={logout}>登出</button>
      </div>
    </aside>

    <header className="admin-mobile-bar">
      <a className="admin-sidebar-brand" href="/"><img src="/aftertrace-icon.svg" alt="" /><div><strong>AFTERTRACE</strong><span>ADMIN</span></div></a>
      <button className="ghost" onClick={logout}>登出</button>
    </header>

    <main className="admin-app-content">{children}</main>
  </div>;
}
