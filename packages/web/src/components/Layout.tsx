import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n, supportedLocales, localeLabels } from '../i18n';

import { BrandLogo } from './Logo';
import { Footer } from './Footer';
import { ConnectionStatus } from './ConnectionStatus';
import { Alert } from '@/components/ui/alert';
import { Settings, UsersRound } from 'lucide-react';

export function Layout({ children }: { children: ReactNode }) {
    const { isOnboarded, identity, persistenceWarning, syncStatus } = useApp();
    const { t, locale, setLocale } = useI18n();
    const location = useLocation();
    const [online, setOnline] = useState(() => navigator.onLine);

    useEffect(() => {
        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const storageWarning = persistenceWarning ? (
        <Alert className="border-red-700/15 bg-red-50 text-red-950">
            {persistenceWarning}
        </Alert>
    ) : null;
    const relayUnavailable = syncStatus === 'disconnected' || syncStatus === 'reconnecting';
    const connectionWarning = !online || relayUnavailable ? (
        <Alert role="status">
            {!online ? t.connection.offline : t.connection.relayUnavailable}
        </Alert>
    ) : null;

    if (!isOnboarded) return <>{storageWarning}{children}</>;

    const isActive = (path: string) =>
        location.pathname === path || location.pathname.startsWith(path + '/');

    return (
        <div className="app-layout">
            {storageWarning}
            {connectionWarning}
            <nav className="sticky top-0 z-50 border-b border-[#004502]/10 bg-white/95 px-3 py-2 backdrop-blur sm:px-6">
                <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
                    <div className="flex items-center">
                        <Link to="/dashboard" className="flex items-center gap-2 font-bold text-[#004502]">
                            <BrandLogo width={28} height={28} />
                            <div className="hidden flex-col leading-tight sm:flex">
                                <span>Fair Money</span>
                                <span className="text-[0.65em] font-medium opacity-80">Split Ledger</span>
                            </div>
                        </Link>
                        <div className="ml-3">
                            <ConnectionStatus />
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <Link
                            to="/dashboard"
                            title={t.nav.groups}
                            className={`flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors ${isActive('/dashboard') ? 'bg-[#004502]/10 text-[#004502]' : 'text-[#716969] hover:bg-[#004502]/5'}`}
                        >
                            <UsersRound className="size-4" /><span className="hidden md:inline">{t.nav.groups}</span>
                        </Link>
                        <Link
                            to="/settings"
                            title={identity?.displayName ?? t.settings.title}
                            className={`flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors ${isActive('/settings') ? 'bg-[#004502]/10 text-[#004502]' : 'text-[#716969] hover:bg-[#004502]/5'}`}
                        >
                            <Settings className="size-4" /><span className="hidden lg:inline">{identity?.displayName ?? t.settings.title}</span>
                        </Link>
                        {/* Compact language switcher in nav */}
                        <select
                            value={locale}
                            onChange={e => setLocale(e.target.value as typeof locale)}
                            className="h-9 cursor-pointer rounded-lg border border-[#004502]/15 bg-transparent px-2 text-xs text-[#716969] outline-none focus:ring-2 focus:ring-[#004502]/30"
                        >
                            {supportedLocales.map(l => (
                                <option key={l} value={l}>
                                    {localeLabels[l]}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </nav >
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
            <Footer />
        </div >
    );
}
