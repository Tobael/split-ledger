import { useState } from 'react';
import { FileKey2, Upload, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { decryptIdentity, readFileAsText } from '../utils/identity-export';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function IdentityFileImport({ onImported, onCancel }: { onImported: () => void; onCancel: () => void }) {
    const { importIdentityFromJson } = useApp();
    const { t } = useI18n();
    const [file, setFile] = useState<File | null>(null);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const importFile = async () => {
        if (!file || password.length < 6) return;
        setBusy(true);
        setError('');
        try {
            const encrypted = await readFileAsText(file);
            const decrypted = await decryptIdentity(encrypted, password);
            await importIdentityFromJson(decrypted);
            onImported();
        } catch (caught) {
            setError(caught instanceof Error && caught.message === 'WRONG_PASSWORD'
                ? t.settings.wrongPassword
                : t.settings.importError);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card className="animate-fade-in">
            <CardHeader className="items-center text-center">
                <div className="flex size-11 items-center justify-center rounded-full bg-[#004502]/10 text-[#004502]"><FileKey2 className="size-5" /></div>
                <CardTitle className="text-xl normal-case tracking-normal text-[#004502]">{t.onboarding.fileImportTitle}</CardTitle>
                <CardDescription>{t.onboarding.fileImportSubtitle}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {error && <Alert className="rounded-lg border border-red-700/15 bg-red-50 text-red-950">{error}</Alert>}
                <div className="space-y-2">
                    <Label htmlFor="identity-file">{t.onboarding.identityFileLabel}</Label>
                    <input id="identity-file" type="file" accept=".json,application/json" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(''); }} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#eef4ef] file:px-3 file:py-2 file:font-medium file:text-[#004502]" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="identity-password">{t.settings.passwordPrompt}</Label>
                    <Input id="identity-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void importFile(); }} autoComplete="current-password" disabled={busy} />
                    {password.length > 0 && password.length < 6 && <p className="text-xs text-[#716969]">{t.settings.passwordMinLength}</p>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Button variant="ghost" onClick={onCancel} disabled={busy}><X className="size-4" />{t.common.cancel}</Button>
                    <Button onClick={() => void importFile()} disabled={!file || password.length < 6 || busy}><Upload className="size-4" />{busy ? t.settings.importing : t.settings.importButton}</Button>
                </div>
            </CardContent>
        </Card>
    );
}
