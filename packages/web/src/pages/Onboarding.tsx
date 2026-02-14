import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';

export function Onboarding() {
    const { createIdentity } = useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [step, setStep] = useState<'welcome' | 'name' | 'creating'>('welcome');

    const handleCreate = () => {
        if (!name.trim()) return;
        setStep('creating');
        setTimeout(() => {
            createIdentity(name.trim());
            navigate('/dashboard');
        }, 800);
    };

    return (
        <div style={styles.container}>
            <div style={styles.bgOrb1} />
            <div style={styles.bgOrb2} />

            <div style={styles.content} className="animate-slide-up">
                {step === 'welcome' && (
                    <>
                        <div style={styles.logoContainer}>
                            <span style={styles.logo}>💸</span>
                            <h1 style={styles.title}>Fair Money</h1>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 500, color: 'var(--text-secondary)', marginTop: '-0.5rem' }}>Split Ledger</h2>
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
                        <button
                            className="btn btn--primary btn--lg btn--full"
                            onClick={() => setStep('name')}
                            style={{ marginTop: 'var(--space-6)' }}
                        >
                            {t.onboarding.getStarted}
                        </button>
                    </>
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
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)', position: 'relative', overflow: 'hidden' },
    bgOrb1: { position: 'absolute', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(34, 211, 238, 0.08), transparent 70%)', top: '-200px', right: '-100px', pointerEvents: 'none' },
    bgOrb2: { position: 'absolute', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(129, 140, 248, 0.06), transparent 70%)', bottom: '-150px', left: '-100px', pointerEvents: 'none' },
    content: { width: '100%', maxWidth: '420px', textAlign: 'center' as const, position: 'relative' as const, zIndex: 1 },
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

const style = document.createElement('style');
style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(style);
