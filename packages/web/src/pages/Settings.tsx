import { useState, useRef } from 'react';
import { useApp, type IdentityState } from '../context/AppContext';
import { useI18n, supportedLocales, localeLabels } from '../i18n';
import {
    encryptIdentity,
    downloadIdentityFile,
    decryptIdentity,
    readFileAsText,
} from '../utils/identity-export';

export function Settings() {
    const { identity, restoreIdentity } = useApp();
    const { t, locale, setLocale } = useI18n();

    // Export/Import state
    const [exportPassword, setExportPassword] = useState('');
    const [importPassword, setImportPassword] = useState('');
    const [showExport, setShowExport] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!identity) return null;

    const pubkeyShort = identity.rootKeyPair.publicKey.slice(0, 8) + '…' + identity.rootKeyPair.publicKey.slice(-8);
    const devicePubkeyShort = identity.device.deviceKeyPair.publicKey.slice(0, 8) + '…' + identity.device.deviceKeyPair.publicKey.slice(-8);

    const handleExport = async () => {
        if (exportPassword.length < 6) {
            setStatus({ type: 'error', msg: t.settings.passwordMinLength });
            return;
        }
        setBusy(true);
        setStatus(null);
        try {
            const json = JSON.stringify(identity);
            const encrypted = await encryptIdentity(json, exportPassword);
            downloadIdentityFile(encrypted);
            setStatus({ type: 'success', msg: t.settings.exportSuccess });
            setShowExport(false);
            setExportPassword('');
        } catch {
            setStatus({ type: 'error', msg: 'Export failed' });
        } finally {
            setBusy(false);
        }
    };

    const handleImport = async () => {
        if (!importFile) return;
        if (importPassword.length < 6) {
            setStatus({ type: 'error', msg: t.settings.passwordMinLength });
            return;
        }
        setBusy(true);
        setStatus(null);
        try {
            const fileContent = await readFileAsText(importFile);
            const decryptedJson = await decryptIdentity(fileContent, importPassword);
            const imported = JSON.parse(decryptedJson) as IdentityState;

            // Basic validation
            if (!imported.displayName || !imported.rootKeyPair?.publicKey || !imported.device?.deviceKeyPair) {
                setStatus({ type: 'error', msg: t.settings.importError });
                setBusy(false);
                return;
            }

            restoreIdentity(imported);
            setStatus({ type: 'success', msg: t.settings.importSuccess });

            // Reload after a short delay so the user sees the success message
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            const msg = err instanceof Error && err.message === 'WRONG_PASSWORD'
                ? t.settings.wrongPassword
                : err instanceof Error && err.message === 'INVALID_FILE'
                    ? t.settings.importError
                    : t.settings.importError;
            setStatus({ type: 'error', msg });
        } finally {
            setBusy(false);
        }
    };

    const sectionHeading = { fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' };
    const cardStyle = { padding: 'var(--space-6)', marginBottom: 'var(--space-4)' };

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="page-header">
                <h1 className="page-header__title">{t.settings.title}</h1>
                <p className="page-header__subtitle">{t.settings.subtitle}</p>
            </div>

            {/* Status banner */}
            {status && (
                <div style={{
                    padding: 'var(--space-3) var(--space-4)',
                    background: status.type === 'success' ? 'var(--accent-primary-dim)' : 'var(--danger-dim)',
                    borderRadius: 'var(--radius-md)',
                    color: status.type === 'success' ? 'var(--accent-primary)' : 'var(--danger)',
                    fontSize: 'var(--font-size-sm)',
                    marginBottom: 'var(--space-4)',
                }}>
                    {status.msg}
                </div>
            )}

            {/* Identity */}
            <div className="glass-card glass-card--static animate-fade-in" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.identityTitle}</h3>
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
            <div className="glass-card glass-card--static animate-fade-in stagger-1" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.deviceTitle}</h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>{identity.device.deviceName}</div>
                        <code style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{devicePubkeyShort}</code>
                    </div>
                    <span className="badge badge--positive">{t.common.active}</span>
                </div>
            </div>

            {/* Account Transfer */}
            <div className="glass-card glass-card--static animate-fade-in stagger-2" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.transferTitle}</h3>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
                    {t.settings.transferDescription}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {/* Export */}
                    {!showExport ? (
                        <button className="btn btn--secondary" onClick={() => { setShowExport(true); setShowImport(false); setStatus(null); }}>
                            {t.settings.exportButton}
                        </button>
                    ) : (
                        <div style={{
                            padding: 'var(--space-4)',
                            background: 'var(--bg-primary)',
                            borderRadius: 'var(--radius-md)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--space-3)',
                        }}>
                            <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                                {t.settings.passwordPrompt}
                            </label>
                            <input
                                className="form-input"
                                type="password"
                                value={exportPassword}
                                onChange={e => setExportPassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleExport()}
                                autoFocus
                                placeholder="••••••"
                            />
                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                <button className="btn btn--ghost" onClick={() => { setShowExport(false); setExportPassword(''); }} style={{ flex: 1 }}>
                                    {t.common.cancel}
                                </button>
                                <button className="btn btn--primary" onClick={handleExport} disabled={busy} style={{ flex: 1 }}>
                                    {busy ? t.settings.exporting : t.settings.exportButton}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Import */}
                    {!showImport ? (
                        <button className="btn btn--secondary" onClick={() => { setShowImport(true); setShowExport(false); setStatus(null); }}>
                            {t.settings.importButton}
                        </button>
                    ) : (
                        <div style={{
                            padding: 'var(--space-4)',
                            background: 'var(--bg-primary)',
                            borderRadius: 'var(--radius-md)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--space-3)',
                        }}>
                            <div style={{
                                padding: 'var(--space-3) var(--space-4)',
                                background: 'var(--danger-dim)',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--danger)',
                            }}>
                                ⚠️ {t.settings.importWarning}
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json"
                                onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                                style={{ fontSize: 'var(--font-size-sm)' }}
                            />
                            {importFile && (
                                <>
                                    <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                                        {t.settings.passwordPrompt}
                                    </label>
                                    <input
                                        className="form-input"
                                        type="password"
                                        value={importPassword}
                                        onChange={e => setImportPassword(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleImport()}
                                        placeholder="••••••"
                                    />
                                </>
                            )}
                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                <button className="btn btn--ghost" onClick={() => { setShowImport(false); setImportFile(null); setImportPassword(''); }} style={{ flex: 1 }}>
                                    {t.common.cancel}
                                </button>
                                <button className="btn btn--primary" onClick={handleImport} disabled={!importFile || busy} style={{ flex: 1 }}>
                                    {busy ? t.settings.importing : t.settings.importButton}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Language */}
            <div className="glass-card glass-card--static animate-fade-in stagger-3" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.languageTitle}</h3>
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
            <div className="glass-card glass-card--static animate-fade-in stagger-4" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.securityTitle}</h3>
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
