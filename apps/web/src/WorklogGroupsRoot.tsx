import { useEffect } from 'react';
import { WorklogRoot } from './WorklogRoot';

/**
 * Temporary compatibility shell for the legacy group-management screen.
 * The new record experience lives at `/`, so the "紀錄" tab must always
 * return there instead of switching the legacy WorklogRoot back to its old
 * records layout.
 */
export function WorklogGroupsRoot({ apiBaseUrl }: { apiBaseUrl: string }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('.worklog-main-tabs button');
      if (!button || button.textContent?.trim() !== '紀錄') return;

      event.preventDefault();
      event.stopPropagation();
      window.location.href = '/';
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return <WorklogRoot apiBaseUrl={apiBaseUrl} />;
}
