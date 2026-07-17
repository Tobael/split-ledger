import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Footer } from '../components/Footer';
import { IdentityImport } from '../components/IdentityImport';
import { postAuthRoute } from '../utils/post-auth-route';
import { BrandLogo } from '../components/Logo';
import { Camera, Loader2, ShieldCheck, Smartphone, Upload, UserRoundCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { decryptIdentity } from '../utils/identity-export';

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

    const handleFileImport = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (result) => {
                const password = prompt(t.settings.passwordPrompt);
                if (!password) return;
                try {
                    const decryptedJson = await decryptIdentity(result.target?.result as string, password);
                    const imported = JSON.parse(decryptedJson);
                    if (imported?.format !== 'fair-money-identity-transfer' || imported.version !== 2) throw new Error('Invalid identity transfer');
                    await importIdentityFromJson(decryptedJson);
                    navigate(postAuthRoute(location.pathname, location.search));
                } catch {
                    alert(t.settings.importError);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    return (
        <div className="flex min-h-dvh flex-col bg-[#f7f9f7]">
            <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-8 sm:px-6">
            <div className="w-full animate-slide-up">
                {step === 'welcome' && !showScanner && (
                    <Card>
                        <CardHeader className="items-center text-center">
                            <BrandLogo width={52} height={52} />
                            <CardTitle className="text-3xl normal-case tracking-tight text-[#004502]">Fair Money</CardTitle>
                            <CardDescription className="max-w-sm">{t.onboarding.tagline}<br />{t.onboarding.taglineSub}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="grid gap-2 sm:grid-cols-3">
                            {[
                                [ShieldCheck, t.onboarding.featureEncrypted],
                                [Smartphone, t.onboarding.featureDevice],
                                [UserRoundCheck, t.onboarding.featureNoAccount],
                            ].map(([Icon, text], index) => (
                                <div key={index} className="flex items-center gap-3 rounded-lg bg-[#004502]/5 p-3 sm:flex-col sm:text-center">
                                    <Icon className="size-5 shrink-0 text-[#004502]" />
                                    <span className="text-sm text-[#716969]">{String(text)}</span>
                                </div>
                            ))}
                            </div>
                            <Button size="lg" className="w-full" onClick={() => setStep('name')}>
                                {t.onboarding.getStarted}
                            </Button>
                            <div className="grid grid-cols-2 gap-2">
                                <Button variant="secondary" className="min-w-0 px-3 text-xs sm:text-sm" disabled={!hasCamera} onClick={() => setShowScanner(true)}><Camera className="size-4 shrink-0" /><span className="leading-tight">{t.onboarding.scanQrTitle}</span></Button>
                                <Button variant="secondary" className="min-w-0 px-3 text-xs sm:text-sm" onClick={handleFileImport}><Upload className="size-4 shrink-0" /><span className="leading-tight">{t.settings.importButton}</span></Button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {showScanner && (
                    <IdentityImport onCancel={() => setShowScanner(false)} />
                )}

                {step === 'name' && (
                    <Card>
                        <CardHeader><CardTitle className="text-2xl normal-case tracking-normal text-[#004502]">{t.onboarding.whatsYourName}</CardTitle><CardDescription>{t.onboarding.nameSubtitle}</CardDescription></CardHeader>
                        <CardContent className="space-y-5">
                            <Input
                                type="text"
                                placeholder={t.onboarding.namePlaceholder}
                                value={name}
                                onChange={e => setName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                autoFocus
                                className="text-center text-lg"
                            />
                        <div className="flex gap-2">
                            <Button variant="ghost" onClick={() => setStep('welcome')}>
                                {t.common.back}
                            </Button>
                            <Button
                                size="lg"
                                className="flex-1"
                                onClick={handleCreate}
                                disabled={!name.trim()}
                            >
                                {t.onboarding.createIdentity}
                            </Button>
                        </div>
                        <p className="text-center text-xs leading-relaxed text-gray-400">{t.onboarding.keyHint}</p>
                        </CardContent>
                    </Card>
                )}

                {step === 'creating' && (
                    <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center"><Loader2 className="size-10 animate-spin text-[#004502]" /><h2 className="text-xl font-semibold">{t.onboarding.generatingTitle}</h2><p className="text-sm text-[#716969]">{t.onboarding.generatingSub}</p></CardContent></Card>
                )}
            </div>
            </main>
            <Footer />
        </div>
    );
}
