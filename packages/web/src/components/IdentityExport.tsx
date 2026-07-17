import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Eye, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function IdentityExport() {
    const { identity, exportIdentityTransferV2 } = useApp();
    const { t } = useI18n();
    const [showSecret, setShowSecret] = useState(false);
    const [payload, setPayload] = useState('');

    useEffect(() => {
        if (!showSecret) return;
        void exportIdentityTransferV2().then(setPayload);
    }, [exportIdentityTransferV2, showSecret]);

    if (!identity) return null;

    return (
        <div className="rounded-xl border border-[#004502]/10 bg-[#f7f9f7] p-4 text-center sm:p-5">
            <h3 className="text-base font-semibold">
                {t.settings?.exportIdentityTitle ?? 'Export Identity'}
            </h3>
            <p className="mt-1 text-sm text-[#716969]">
                {t.settings?.exportIdentitySubtitle ?? 'Scan this QR code on another device to log in.'}
            </p>

            {!showSecret ? (
                <div className="mt-4 flex flex-col items-center gap-3 rounded-lg bg-white p-4">
                    <ShieldAlert className="size-8 text-amber-700" />
                    <p className="max-w-sm text-sm text-[#716969]">
                        {t.settings?.exportWarning ?? 'This QR code contains your private key. Do not share it!'}
                    </p>
                    <Button variant="destructive" size="sm" onClick={() => setShowSecret(true)}>
                        <Eye className="size-4" />
                        {t.settings?.revealQr ?? 'Reveal QR Code'}
                    </Button>
                </div>
            ) : payload ? (
                <div className="mt-4 animate-fade-in">
                    <div className="inline-block max-w-full overflow-auto rounded-lg bg-white p-3">
                        <QRCodeSVG
                            value={payload}
                            size={224}
                            level="H"
                            includeMargin={true}
                        />
                    </div>
                    <p className="mt-2 text-xs font-medium text-red-700">
                        {t.settings?.keepPrivate ?? 'Keep this screen private!'}
                    </p>
                </div>
            ) : <Loader2 className="mx-auto mt-4 size-5 animate-spin text-[#716969]" aria-label={t.common.loading} />}
        </div>
    );
}
