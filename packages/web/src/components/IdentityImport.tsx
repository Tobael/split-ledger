import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { useNavigate } from 'react-router-dom';

export function IdentityImport({ onCancel }: { onCancel: () => void }) {
    const { importIdentity } = useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);

    useEffect(() => {
        // Initialize scanner
        const scanner = new Html5QrcodeScanner(
            "reader",
            { fps: 10, qrbox: { width: 250, height: 250 } },
            /* verbose= */ false
        );
        scannerRef.current = scanner;

        scanner.render(onScanSuccess, onScanFailure);

        function onScanSuccess(decodedText: string) {
            try {
                // Verify it looks like JSON
                if (!decodedText.startsWith('{')) {
                    throw new Error('Invalid QR Code format');
                }

                importIdentity(decodedText);
                scanner.clear().catch(console.error);
                navigate('/dashboard');
            } catch (err) {
                console.error(err);
                setError(t.onboarding?.importInvalid ?? 'Invalid QR Code. Please try again.');
            }
        }

        function onScanFailure(error: any) {
            // handle scan failure, usually better to ignore and keep scanning.
            console.warn(`Code scan error = ${error}`);
        }

        return () => {
            scanner.clear().catch(() => { });
        };
    }, [importIdentity, navigate, t]);

    return (
        <div className="glass-card glass-card--static animate-fade-in" style={{ padding: 'var(--space-6)', width: '100%', maxWidth: '400px' }}>
            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-4)', textAlign: 'center' }}>
                {t.onboarding?.scanQrTitle ?? 'Scan Identity QR'}
            </h3>

            <div id="reader" style={{ width: '100%', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 'var(--space-4)' }}></div>

            {error && (
                <div style={{ color: 'var(--danger)', textAlign: 'center', marginBottom: 'var(--space-4)' }}>
                    {error}
                </div>
            )}

            <button className="btn btn--secondary btn--full" onClick={onCancel}>
                {t.common.cancel}
            </button>
        </div>
    );
}
