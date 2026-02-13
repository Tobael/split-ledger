import { useApp } from '../context/AppContext';
import { useI18n, supportedLocales, localeLabels } from '../i18n';

export function Settings() {
    const { identity } = useApp();
    const { t, locale, setLocale } = useI18n();

    if (!identity) return null;

    const pubkeyShort = identity.rootKeyPair.publicKey.slice(0, 8) + '…' + identity.rootKeyPair.publicKey.slice(-8);
    const devicePubkeyShort = identity.device.deviceKeyPair.publicKey.slice(0, 8) + '…' + identity.device.deviceKeyPair.publicKey.slice(-8);

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="page-header">
                <h1 className="page-header__title">{t.settings.title}</h1>
                <p className="page-header__subtitle">{t.settings.subtitle}</p>
            </div>

            {/* Identity */}
            <div className="glass-card glass-card--static animate-fade-in" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-4)' }}>
                <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t.settings.identityTitle}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>{t.settings.displayNameLabel}</div>
                        <div style={{ fontWeight: 600 }}>{identity.displayName}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>{t.settings.rootKeyLabel}</div>
                        <code style={{
                            padding: 'var(--space-2) var(--space-3)',
                            background: 'var(--bg-primary)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--accent-primary)',
                            display: 'block',
                        }}>
                            {pubkeyShort}
                        </code>
                    </div>
                </div>
            </div>

            {/* Device */}
            <div className="glass-card glass-card--static animate-fade-in stagger-1" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-4)' }}>
                <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t.settings.deviceTitle}
                </h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>{identity.device.deviceName}</div>
                        <code style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{devicePubkeyShort}</code>
                    </div>
                    <span className="badge badge--positive">{t.common.active}</span>
                </div>
            </div>

            {/* Language */}
            <div className="glass-card glass-card--static animate-fade-in stagger-2" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-4)' }}>
                <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t.settings.languageTitle}
                </h3>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    {supportedLocales.map(l => (
                        <button
                            key={l}
                            className={`btn ${locale === l ? 'btn--primary' : 'btn--secondary'}`}
                            onClick={() => setLocale(l)}
                            style={{ flex: 1 }}
                        >
                            {localeLabels[l]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Security */}
            <div className="glass-card glass-card--static animate-fade-in stagger-3" style={{ padding: 'var(--space-6)' }}>
                <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t.settings.securityTitle}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {[
                        ['🔐', t.settings.securityEd25519],
                        ['📋', t.settings.securitySigned],
                        ['🌐', t.settings.securityP2P],
                        ['🔄', t.settings.securityRecovery],
                    ].map(([icon, text], i) => (
                        <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                            <span>{icon}</span>
                            <span>{text}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
