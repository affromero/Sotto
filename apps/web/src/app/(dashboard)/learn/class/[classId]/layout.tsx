import type { ReactNode } from 'react';
import styles from './layout.module.css';

/**
 * The class flow is a full-screen, two-panel experience. This route lives under
 * the (dashboard) group, so it inherits the DashboardShell chrome (sidebar +
 * top bar). Rather than move the route (which would change the documented URL
 * and middleware coverage), we escape the chrome with a fixed full-viewport
 * container — the same visual result as /welcome's own layout, the cleanest
 * opt-out for a route that must stay inside (dashboard).
 */
export default function ClassFullscreenLayout({ children }: { children: ReactNode }) {
  return <div className={styles.fullscreen}>{children}</div>;
}
