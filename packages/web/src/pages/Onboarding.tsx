import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Footer } from '../components/Footer';
import { postAuthRoute } from '../utils/post-auth-route';
import { BrandLogo } from '../components/Logo';
import { Loader2, ShieldCheck, Smartphone, Upload, UserRoundCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { IdentityFileImport } from '../components/IdentityFileImport';

export function Onboarding() {
    const { createIdentity } = useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();
    const [name, setName] = useState('');
    const [step, setStep] = useState<'welcome' | 'name' | 'creating' | 'importing'>('welcome');

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
        <div className="flex min-h-dvh flex-col bg-[#f7f9f7]">
            <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-8 sm:px-6">
            <div className="w-full animate-slide-up">
                {step === 'welcome' && (
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
                            <Button variant="secondary" className="w-full" onClick={() => setStep('importing')}><Upload className="size-4 shrink-0" />{t.settings.importButton}</Button>
                        </CardContent>
                    </Card>
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
                {step === 'importing' && <IdentityFileImport onCancel={() => setStep('welcome')} onImported={() => navigate(postAuthRoute(location.pathname, location.search))} />}
            </div>
            </main>
            <Footer />
        </div>
    );
}
