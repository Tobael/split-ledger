import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Footer } from '../components/Footer';
import { IdentityImport } from '../components/IdentityImport';
import { postAuthRoute } from '../utils/post-auth-route';

export function Onboarding() {
    const { createIdentity, importIdentityFromJson } = useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();
    const [name, setName] = useState('');
    const [step, setStep] = useState<'welcome' | 'name' | 'creating'>('welcome');
    const [showScanner, setShowScanner] = useState(false);
    const [hasCamera, setHasCamera] = useState(false);

    useEffect(() => {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices.enumerateDevices()
                .then(devices => setHasCamera(devices.some(d => d.kind === 'videoinput')))
                .catch(() => setHasCamera(false));
        }
    }, []);

    useEffect(() => {
        const style = document.createElement('style');
        style.textContent = `@keyframes spin {to {transform: rotate(360deg); } }`;
        document.head.appendChild(style);
        return () => {
            document.head.removeChild(style);
        };
    }, []);

    const handleCreate = () => {
        if (!name.trim()) return;
        setStep('creating');
        setTimeout(async () => {
            try {
                await createIdentity(name.trim());
                navigate(postAuthRoute(location.pathname, location.search));
            } catch {
                setStep('name');
            }
        }, 800);
    };

    return (
        <div style={styles.container}>
            <div style={styles.bgOrb1} />
            <div style={styles.bgOrb2} />

            <div style={styles.content} className="animate-slide-up">
                {step === 'welcome' && !showScanner && (
                    <>
                        <div style={styles.logoContainer}>
                            <span style={styles.logo}>💸</span>
                            <h1 style={styles.title}>Fair Money</h1>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 500, color: 'var(--text-secondary)', marginTop: '-0.25rem' }}>Split Ledger</h2>
                        </div>
                        <p style={styles.tagline}>
                            {t.onboarding.tagline}<br />
                            <span style={styles.taglineAccent}>{t.onboarding.taglineSub}</span>
                        </p>
                        <div style={styles.features}>
                            {[
                                ['🔐', t.onboarding.featureEncrypted],
                                ['📱', t.onboarding.featureDevice],
                                ['🌐', t.onboarding.featureNoAccount],
                            ].map(([icon, text], i) => (
                                <div key={i} className={`glass-card glass-card--static stagger-${i + 1} animate-fade-in`} style={styles.featureCard}>
                                    <span style={styles.featureIcon}>{icon}</span>
                                    <span style={styles.featureText}>{text}</span>
                                </div>
                            ))}
                        </div>
                        <div className="onboarding-buttons" style={{ marginTop: 'var(--space-6)', display: 'flex', gap: 'var(--space-3)' }}>
                            <button
                                className="btn btn--primary btn--lg"
                                onClick={() => setStep('name')}
                                style={{ flex: 1 }}
                            >
                                {t.onboarding.getStarted}
                            </button>
                            {hasCamera && (
                                <button
                                    className="btn btn--secondary btn--lg"
                                    onClick={() => setShowScanner(true)}
                                    style={{ padding: '0 var(--space-3)' }}
                                    title={t.onboarding?.importTitle ?? "Scan QR to import identity"}
                                >
                                    📷
                                </button>
                            )}
                            <button
                                className="btn btn--secondary btn--lg"
                                onClick={() => {
                                    // Hidden file input to trigger JSON import
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.accept = '.json';
                                    input.onchange = (e) => {
                                        const file = (e.target as HTMLInputElement).files?.[0];
                                        if (file) {
                                            const reader = new FileReader();
                                            reader.onload = async (re) => {
                                                const content = re.target?.result as string;
                                                const pwd = prompt(t.settings?.passwordPrompt ?? "Enter password to decrypt:");
                                                if (pwd) {
                                                    try {
                                                        const { decryptIdentity } = await import('../utils/identity-export');
                                                        const decryptedJson = await decryptIdentity(content, pwd);
                                                        const imported = JSON.parse(decryptedJson);

                                                        if (imported?.format === 'fair-money-identity-transfer' && imported.version === 2) {
                                                            await importIdentityFromJson(decryptedJson);
                                                            navigate(postAuthRoute(location.pathname, location.search));
                                                        } else {
                                                            throw new Error("Invalid identity file structure");
                                                        }
                                                    } catch {
                                                        alert(t.settings?.importError ?? "Invalid file or password");
                                                    }
                                                }
                                            };
                                            reader.readAsText(file);
                                        }
                                    };
                                    input.click();
                                }}
                                style={{ padding: '0 var(--space-3)' }}
                                title={t.settings?.importButton ?? "Import Identity from JSON"}
                            >
                                📁
                            </button>
                        </div>
                    </>
                )}

                {showScanner && (
                    <IdentityImport onCancel={() => setShowScanner(false)} />
                )}

                {step === 'name' && (
                    <>
                        <h2 style={styles.stepTitle}>{t.onboarding.whatsYourName}</h2>
                        <p style={styles.stepDesc}>{t.onboarding.nameSubtitle}</p>
                        <div className="form-group" style={{ marginTop: 'var(--space-6)' }}>
                            <input
                                className="form-input"
                                type="text"
                                placeholder={t.onboarding.namePlaceholder}
                                value={name}
                                onChange={e => setName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                autoFocus
                                style={{ fontSize: 'var(--font-size-lg)', textAlign: 'center' }}
                            />
                        </div>
                        <div style={styles.btnRow}>
                            <button className="btn btn--ghost" onClick={() => setStep('welcome')}>
                                {t.common.back}
                            </button>
                            <button
                                className="btn btn--primary btn--lg"
                                onClick={handleCreate}
                                disabled={!name.trim()}
                                style={{ flex: 1 }}
                            >
                                {t.onboarding.createIdentity}
                            </button>
                        </div>
                        <p style={styles.hint}>{t.onboarding.keyHint}</p>
                    </>
                )}

                {step === 'creating' && (
                    <div style={styles.creatingContainer}>
                        <div style={styles.spinner} />
                        <h2 style={styles.stepTitle}>{t.onboarding.generatingTitle}</h2>
                        <p style={styles.stepDesc}>{t.onboarding.generatingSub}</p>
                    </div>
                )}
            </div>

            <Footer />
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflowX: 'hidden'
    },
    bgOrb1: { position: 'absolute', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(34, 211, 238, 0.08), transparent 70%)', top: '-200px', right: '-100px', pointerEvents: 'none' },
    bgOrb2: { position: 'absolute', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(129, 140, 248, 0.06), transparent 70%)', bottom: '-150px', left: '-100px', pointerEvents: 'none' },
    content: {
        flex: 1,
        width: '100%',
        maxWidth: '420px',
        margin: '0 auto',
        padding: 'var(--space-6)',
        paddingBottom: '80px', // Extra padding for small screens to prevent footer overlap
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        textAlign: 'center' as const,
        position: 'relative' as const,
        zIndex: 1
    },
    logoContainer: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' },
    logo: { fontSize: '4rem' },
    title: { fontSize: 'var(--font-size-4xl)', fontWeight: 700, background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.03em' },
    tagline: { fontSize: 'var(--font-size-lg)', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 'var(--space-8)' },
    taglineAccent: { color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' },
    features: { display: 'flex', flexDirection: 'column' as const, gap: 'var(--space-3)' },
    featureCard: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)' },
    featureIcon: { fontSize: '1.25rem' },
    featureText: { fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' },
    stepTitle: { fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' },
    stepDesc: { color: 'var(--text-secondary)' },
    btnRow: { display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' },
    hint: { marginTop: 'var(--space-6)', fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 },
    creatingContainer: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 'var(--space-4)' },
    spinner: { width: '48px', height: '48px', border: '3px solid var(--bg-tertiary)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
};
