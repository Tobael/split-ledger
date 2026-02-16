import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';

export function IdentityExport() {
    const { identity } = useApp();
    const { t } = useI18n();
    const [showSecret, setShowSecret] = useState(false);

    if (!identity) return null;

    // Export payload: { rootSecretKey, rootPublicKey, displayName }
    const payload = JSON.stringify({
        rootSecretKey: identity.rootKeyPair.secretKey,
        rootPublicKey: identity.rootKeyPair.publicKey,
        displayName: identity.displayName,
    });

    return (
        <div className="glass-card glass-card--static" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                {t.settings?.exportIdentityTitle ?? 'Export Identity'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
                {t.settings?.exportIdentitySubtitle ?? 'Scan this QR code on another device to log in.'}
            </p>

            {!showSecret ? (
                <div style={{ padding: 'var(--space-8)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ fontSize: '3rem', marginBottom: 'var(--space-4)' }}>🙈</div>
                    <p style={{ marginBottom: 'var(--space-4)', color: 'var(--text-secondary)' }}>
                        {t.settings?.exportWarning ?? 'This QR code contains your private key. Do not share it!'}
                    </p>
                    <button className="btn btn--danger" onClick={() => setShowSecret(true)}>
                        {t.settings?.revealQr ?? 'Reveal QR Code'}
                    </button>
                </div>
            ) : (
                <div className="animate-fade-in">
                    <div style={{
                        padding: 'var(--space-4)',
                        background: 'white',
                        borderRadius: 'var(--radius-lg)',
                        display: 'inline-block',
                        marginBottom: 'var(--space-4)'
                    }}>
                        <QRCodeSVG
                            value={payload}
                            size={256}
                            level="H"
                            includeMargin={true}
                        />
                    </div>
                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                        {t.settings?.keepPrivate ?? 'Keep this screen private!'}
                    </p>
                </div>
            )}
        </div>
    );
}
