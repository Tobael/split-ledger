import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { useNavigate, useLocation } from 'react-router-dom';
import { postAuthRoute } from '../utils/post-auth-route';
import { Camera, Loader2, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
            qrbox: { width: 220, height: 220 },
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
        };

        const startScanning = async () => {
            try {
                // Check if any camera exists before starting
                const devices = await navigator.mediaDevices.enumerateDevices();
                const hasCamera = devices.some(d => d.kind === 'videoinput');
                if (!hasCamera) {
                    setPermissionError(true);
                    setError(t.onboarding.cameraError);
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
                    setError(t.onboarding.cameraError);
                }
            }
        };

        startScanning();

        async function onScanSuccess(decodedText: string) {
            if (!isScanningRef.current) return;

            try {
                // Verify it looks like JSON
                if (!decodedText.startsWith('{')) {
                    // ignore partial scans or other codes
                    return;
                }

                await importIdentity(decodedText);

                // Stop scanning immediately on success
                isScanningRef.current = false;
                scanner.stop().then(() => {
                    scanner.clear();
                    navigate(postAuthRoute(location.pathname, location.search));
                }).catch(console.error);

            } catch (err) {
                console.error(err);
                setError(t.onboarding.importInvalid);
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
    }, [importIdentity, navigate, t, location.pathname, location.search]);

    return (
        <Card className="w-full max-w-sm animate-fade-in p-4 sm:p-6">
            <CardHeader className="items-center text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-[#004502]/10 text-[#004502]"><Camera className="size-5" /></div>
                <CardTitle className="text-lg normal-case tracking-normal text-[#004502]">{t.onboarding.scanQrTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
            <div id="reader" className="min-h-64 w-full overflow-hidden rounded-lg bg-black">
                {/* Placeholder for camera loading state */}
                {!error && !permissionError && (
                    <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-gray-400">
                        <Loader2 className="size-5 animate-spin" />{t.common.loading}
                    </div>
                )}
            </div>

            {error && (
                <Alert className="rounded-lg border border-red-700/15 bg-red-50 text-red-950">{error}</Alert>
            )}

            {permissionError && (
                <p className="text-center text-sm text-[#716969]">{t.onboarding.cameraPermissionHelp}</p>
            )}

            <Button variant="secondary" className="w-full" onClick={() => {
                // Ensure we stop scanning before cancelling
                if (scannerRef.current && scannerRef.current.isScanning) {
                    scannerRef.current.stop().catch(console.error).finally(onCancel);
                } else {
                    onCancel();
                }
            }}>
                <X className="size-4" />{t.common.cancel}
            </Button>
            </CardContent>
        </Card>
    );
}
