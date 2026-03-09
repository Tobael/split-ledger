import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { useNavigate, useLocation } from 'react-router-dom';
export function IdentityImport({ onCancel }: { onCancel: () => void }) {
    const { importIdentity } = useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();
    const [error, setError] = useState('');
    const [permissionError, setPermissionError] = useState(false);

    // Use a ref for the instance to handle cleanup properly
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const isScanningRef = useRef(false);

    useEffect(() => {
        const scannerId = "reader";

        // Initialize instance
        const scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;

        // Config
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
        };

        const startScanning = async () => {
            try {
                // Check if any camera exists before starting
                const devices = await navigator.mediaDevices.enumerateDevices();
                const hasCamera = devices.some(d => d.kind === 'videoinput');
                if (!hasCamera) {
                    setPermissionError(true);
                    setError(t.onboarding?.cameraError ?? "No camera found. Please use JSON import.");
                    return;
                }

                // Prefer back camera, fallback to any if not available (e.g. laptop)
                await scanner.start(
                    { facingMode: "environment" },
                    config,
                    onScanSuccess,
                    undefined // onScanFailure (too noisy)
                );
                isScanningRef.current = true;
            } catch (err) {
                console.warn("Failed to start camera with 'environment', trying default.", err);
                try {
                    // Fallback to user facing or default
                    await scanner.start(
                        { facingMode: "user" },
                        config,
                        onScanSuccess,
                        undefined
                    );
                    isScanningRef.current = true;
                } catch (e) {
                    console.error("Camera start failed completely", e);
                    setPermissionError(true);
                    setError(t.onboarding?.cameraError ?? "Could not access camera.");
                }
            }
        };

        startScanning();

        function onScanSuccess(decodedText: string) {
            if (!isScanningRef.current) return;

            try {
                // Verify it looks like JSON
                if (!decodedText.startsWith('{')) {
                    // ignore partial scans or other codes
                    return;
                }

                importIdentity(decodedText);

                // Stop scanning immediately on success
                isScanningRef.current = false;
                scanner.stop().then(() => {
                    scanner.clear();
                    if (location.pathname !== '/' && location.pathname !== '/dashboard') {
                        navigate(location.pathname + location.search);
                    } else {
                        navigate('/dashboard');
                    }
                }).catch(console.error);

            } catch (err) {
                console.error(err);
                setError(t.onboarding?.importInvalid ?? 'Invalid QR Code. Please try again.');
            }
        }

        return () => {
            isScanningRef.current = false;
            // Cleanup: stop if running, then clear
            if (scanner.isScanning) {
                scanner.stop().then(() => scanner.clear()).catch(console.error);
            } else {
                scanner.clear();
            }
        };
    }, [importIdentity, navigate, t]);

    return (
        <div className="glass-card glass-card--static animate-fade-in" style={{ padding: 'var(--space-6)', width: '100%', maxWidth: '400px' }}>
            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-4)', textAlign: 'center' }}>
                {t.onboarding?.scanQrTitle ?? 'Scan Identity QR'}
            </h3>

            <div id="reader" style={{ width: '100%', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 'var(--space-4)', minHeight: '300px', background: '#000' }}>
                {/* Placeholder for camera loading state */}
                {!error && !permissionError && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', color: '#666' }}>
                        {t.common?.loading ?? 'Starting camera...'}
                    </div>
                )}
            </div>

            {error && (
                <div style={{ color: 'var(--danger)', textAlign: 'center', marginBottom: 'var(--space-4)' }}>
                    {error}
                </div>
            )}

            {permissionError && (
                <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 'var(--space-4)', fontSize: '0.9em' }}>
                    Please ensure you have granted camera permissions.
                </div>
            )}

            <button className="btn btn--secondary btn--full" onClick={() => {
                // Ensure we stop scanning before cancelling
                if (scannerRef.current && scannerRef.current.isScanning) {
                    scannerRef.current.stop().catch(console.error).finally(onCancel);
                } else {
                    onCancel();
                }
            }}>
                {t.common.cancel}
            </button>
        </div>
    );
}
