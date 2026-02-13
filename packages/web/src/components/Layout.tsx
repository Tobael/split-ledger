import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n, supportedLocales, localeLabels } from '../i18n';

export function Layout({ children }: { children: ReactNode }) {
    const { isOnboarded, identity, syncStatus } = useApp();
    const { t, locale, setLocale } = useI18n();
    const location = useLocation();

    if (!isOnboarded) return <>{children}</>;

    const isActive = (path: string) =>
        location.pathname === path || location.pathname.startsWith(path + '/');

    const syncColor = syncStatus === 'connected' ? 'var(--success)' :
        syncStatus === 'reconnecting' || syncStatus === 'connecting' ? 'var(--warning, orange)' : 'var(--text-tertiary)';

    return (
        <div className="app-layout">
            <nav className="app-nav">
                <div className="app-nav__inner">
                    <Link to="/dashboard" className="app-nav__logo" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        SplitLedger
                        <span title={syncStatus} style={{
                            width: '8px', height: '8px', borderRadius: '50%',
                            background: syncColor, display: 'inline-block',
                            boxShadow: syncStatus === 'connected' ? `0 0 6px ${syncColor}` : 'none',
                        }} />
                    </Link>
                    <div className="app-nav__links">
                        <Link
                            to="/dashboard"
                            className={`app-nav__link ${isActive('/dashboard') ? 'app-nav__link--active' : ''}`}
                        >
                            {t.nav.groups}
                        </Link>
                        <Link
                            to="/settings"
                            className={`app-nav__link ${isActive('/settings') ? 'app-nav__link--active' : ''}`}
                        >
                            {identity?.displayName ?? t.settings.title}
                        </Link>
                        {/* Compact language switcher in nav */}
                        <select
                            value={locale}
                            onChange={e => setLocale(e.target.value as typeof locale)}
                            className="nav-lang-select"
                            style={{
                                background: 'transparent',
                                border: '1px solid var(--glass-border)',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--text-secondary)',
                                fontSize: 'var(--font-size-xs)',
                                padding: '4px 8px',
                                cursor: 'pointer',
                                fontFamily: 'var(--font-family)',
                                outline: 'none',
                            }}
                        >
                            {supportedLocales.map(l => (
                                <option key={l} value={l} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                                    {localeLabels[l]}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </nav>
            <main className="app-main">{children}</main>
        </div>
    );
}
