import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n, supportedLocales, localeLabels } from '../i18n';
import {
    encryptIdentity,
    downloadIdentityFile,
    decryptIdentity,
    readFileAsText,
} from '../utils/identity-export';
import { IdentityExport } from '../components/IdentityExport';
import type { GroupId } from '@splitledger/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Download, KeyRound, Languages, Pencil, ShieldCheck, Trash2, Upload } from 'lucide-react';

export function Settings() {
    const {
        identity, restoreIdentity, deleteIdentity, groups,
        getAuthorizedDevicesV2, revokeDeviceV2,
        exportIdentityTransferV2, importIdentityFromJson, preferredRelayUrl, setPreferredRelayUrl,
    } = useApp();
    const { t, locale, setLocale } = useI18n();

    // Export/Import state
    const [exportPassword, setExportPassword] = useState('');
    const [importPassword, setImportPassword] = useState('');
    const [showExport, setShowExport] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [editNameValue, setEditNameValue] = useState(identity?.displayName ?? '');
    const [importFile, setImportFile] = useState<File | null>(null);
    const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [relayUrl, setRelayUrl] = useState(preferredRelayUrl);
    const [authorizedDevices, setAuthorizedDevices] = useState<Map<string, { name: string; groups: GroupId[] }>>(new Map());
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!identity || !groups) return;
        const loadDevices = async () => {
            const devices = await getAuthorizedDevicesV2();
            setAuthorizedDevices(devices);
        };
        loadDevices();
    }, [groups, identity, getAuthorizedDevicesV2]);

    const handleRevoke = async (deviceKey: string) => {
        if (!confirm(t.settings.confirmRevoke)) return;
        setBusy(true);
        setStatus(null);
        try {
            await revokeDeviceV2(deviceKey);
            setAuthorizedDevices(await getAuthorizedDevicesV2());
            setStatus({ type: 'success', msg: t.settings.deviceRevoked });
        } catch {
            setStatus({ type: 'error', msg: t.settings.revokeFailed });
        } finally {
            setBusy(false);
        }
    };

    if (!identity) return null;

    const pubkeyShort = identity.rootKeyPair.publicKey.slice(0, 8) + '…' + identity.rootKeyPair.publicKey.slice(-8);
    const devicePubkeyShort = identity.device.deviceKeyPair.publicKey.slice(0, 8) + '…' + identity.device.deviceKeyPair.publicKey.slice(-8);

    const handleExport = async () => {
        if (exportPassword.length < 6) {
            setStatus({ type: 'error', msg: t.settings.passwordMinLength });
            return;
        }
        setBusy(true);
        setStatus(null);
        try {
            const transfer = await exportIdentityTransferV2();
            const encrypted = await encryptIdentity(transfer, exportPassword);
            downloadIdentityFile(encrypted);
            setStatus({ type: 'success', msg: t.settings.exportSuccess });
            setShowExport(false);
            setExportPassword('');
        } catch {
            setStatus({ type: 'error', msg: t.settings.exportFailed });
        } finally {
            setBusy(false);
        }
    };

    const handleImport = async () => {
        if (!importFile) return;
        if (importPassword.length < 6) {
            setStatus({ type: 'error', msg: t.settings.passwordMinLength });
            return;
        }
        setBusy(true);
        setStatus(null);
        try {
            const fileContent = await readFileAsText(importFile);
            const decryptedJson = await decryptIdentity(fileContent, importPassword);
            await importIdentityFromJson(decryptedJson);
            setStatus({ type: 'success', msg: t.settings.importSuccess });

            // Reload after a short delay so the user sees the success message
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            const msg = err instanceof Error && err.message === 'WRONG_PASSWORD'
                ? t.settings.wrongPassword
                : err instanceof Error && err.message === 'INVALID_FILE'
                    ? t.settings.importError
                    : t.settings.importError;
            setStatus({ type: 'error', msg });
        } finally {
            setBusy(false);
        }
    };

    const handleSaveName = async () => {
        const newName = editNameValue.trim();
        if (!newName) return;

        setBusy(true);
        setStatus(null);
        try {
            // Update personal identity
            const newIdentity = { ...identity, displayName: newName };
            await restoreIdentity(newIdentity);

            setStatus({ type: 'success', msg: t.settings.renameSuccess || 'Name updated' });
            setIsEditingName(false);
        } catch {
            setStatus({ type: 'error', msg: t.settings.renameFailed });
        } finally {
            setBusy(false);
        }
    };

    const handleSaveRelay = () => {
        setStatus(null);
        try {
            setPreferredRelayUrl(relayUrl);
            setStatus({ type: 'success', msg: t.settings.relaySaved });
        } catch {
            setStatus({ type: 'error', msg: t.settings.relayInvalid });
        }
    };

    return (
        <div className="mx-auto max-w-2xl space-y-4 pb-8">
            <div className="page-header">
                <h1 className="page-header__title">{t.settings.title}</h1>
                <p className="page-header__subtitle">{t.settings.subtitle}</p>
            </div>

            {/* Status banner */}
            {status && (
                <Alert className={status.type === 'success' ? 'rounded-lg border border-green-700/15 bg-green-50 text-green-950' : 'rounded-lg border border-red-700/15 bg-red-50 text-red-950'}>
                    {status.msg}
                </Alert>
            )}

            {/* Identity */}
            <Card className="animate-fade-in">
                <CardHeader><CardTitle>{t.settings.identityTitle}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label htmlFor="display-name">{t.settings.displayNameLabel}</Label>
                        {isEditingName ? (
                            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                                <Input id="display-name"
                                    value={editNameValue}
                                    onChange={e => setEditNameValue(e.target.value)}
                                    disabled={busy}
                                    autoFocus
                                    onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                                />
                                <Button onClick={handleSaveName} disabled={busy || !editNameValue.trim()}>{t.common.save}</Button>
                                <Button variant="ghost" onClick={() => { setIsEditingName(false); setEditNameValue(identity.displayName); }} disabled={busy}>{t.common.cancel}</Button>
                            </div>
                        ) : (
                            <div className="mt-1 flex items-center justify-between gap-3">
                                <div className="font-semibold">{identity.displayName}</div>
                                <Button variant="secondary" size="sm" onClick={() => setIsEditingName(true)}><Pencil className="size-3.5" />{t.groupDetail.renameParticipant}</Button>
                            </div>
                        )}
                    </div>
                    <div>
                        <Label>{t.settings.rootKeyLabel}</Label>
                        <code className="mt-1 block rounded-lg bg-[#f7f9f7] px-3 py-2 text-xs text-[#004502]">
                            {pubkeyShort}
                        </code>
                    </div>
                </CardContent>
            </Card>

            <Card className="mb-4 animate-fade-in">
                <CardHeader>
                    <CardTitle>{t.settings.relayTitle}</CardTitle>
                    <CardDescription>{t.settings.relayDescription}</CardDescription>
                </CardHeader>
                <CardContent>
                    <Label htmlFor="relay-url">{t.settings.relayUrlLabel}</Label>
                    <div className="flex items-center gap-2">
                    <Input
                        id="relay-url"
                        type="url"
                        inputMode="url"
                        value={relayUrl}
                        onChange={(event) => setRelayUrl(event.target.value)}
                        placeholder="wss://relay.example.org/ws"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <Button type="button" onClick={handleSaveRelay}>
                        {t.common.save}
                    </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Device */}
            <Card className="animate-fade-in stagger-1">
                <CardHeader><CardTitle>{t.settings.deviceTitle}</CardTitle></CardHeader>
                <CardContent>

                {/* Current Device */}
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="font-semibold">
                            {identity.device.deviceName} <span className="text-xs font-normal text-[#716969]">({t.settings.thisDevice})</span>
                        </div>
                        <code className="text-xs text-[#716969]">{devicePubkeyShort}</code>
                    </div>
                    <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">{t.common.active}</span>
                </div>

                {/* Other Devices */}
                {authorizedDevices.size > 1 && (
                    <>
                        <h4 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-[#716969]">{t.settings.authorizedDevices}</h4>
                        <div className="space-y-2">
                            {[...authorizedDevices.entries()].filter(([k]) => k !== identity.device.deviceKeyPair.publicKey).map(([key, data]) => (
                                <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-[#f7f9f7] p-3">
                                    <div className="min-w-0">
                                        <div className="truncate font-medium">{data.name}</div>
                                        <code className="block text-xs text-[#716969]">{key.slice(0, 8)}…{key.slice(-8)}</code>
                                        <div className="text-xs text-[#716969]">{t.settings.groupAccessCount(data.groups.length)}</div>
                                    </div>
                                    <Button variant="secondary" size="sm" className="text-red-700"
                                        onClick={() => handleRevoke(key)}
                                        disabled={busy}
                                    >
                                        {t.settings.revoke}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </>
                )}
                </CardContent>
            </Card>

            {/* Account Transfer */}
            <Card className="animate-fade-in stagger-2">
                <CardHeader><CardTitle>{t.settings.transferTitle}</CardTitle><CardDescription>{t.settings.transferDescription}</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                    <IdentityExport />
                    {!showExport ? (
                        <Button variant="secondary" className="w-full" onClick={() => { setShowExport(true); setShowImport(false); setStatus(null); }}>
                            <Download className="size-4" />
                            {t.settings.exportButton}
                        </Button>
                    ) : (
                        <div className="space-y-3 rounded-lg bg-[#f7f9f7] p-4">
                            <Label htmlFor="export-password">{t.settings.passwordPrompt}</Label>
                            <Input id="export-password"
                                type="password"
                                value={exportPassword}
                                onChange={e => setExportPassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleExport()}
                                autoFocus
                                placeholder="••••••"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <Button variant="ghost" onClick={() => { setShowExport(false); setExportPassword(''); }}>{t.common.cancel}</Button>
                                <Button onClick={handleExport} disabled={busy}>{busy ? t.settings.exporting : t.settings.exportButton}</Button>
                            </div>
                        </div>
                    )}
                    {!showImport ? (
                        <Button variant="secondary" className="w-full" onClick={() => { setShowImport(true); setShowExport(false); setStatus(null); }}>
                            <Upload className="size-4" />
                            {t.settings.importButton}
                        </Button>
                    ) : (
                        <div className="space-y-3 rounded-lg bg-[#f7f9f7] p-4">
                            <Alert className="rounded-lg border border-amber-700/15">{t.settings.importWarning}</Alert>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json"
                                onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#eef4ef] file:px-3 file:py-2 file:font-medium file:text-[#004502]"
                            />
                            {importFile && (
                                <>
                                    <Label htmlFor="import-password">{t.settings.passwordPrompt}</Label>
                                    <Input id="import-password"
                                        type="password"
                                        value={importPassword}
                                        onChange={e => setImportPassword(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleImport()}
                                        placeholder="••••••"
                                    />
                                </>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                                <Button variant="ghost" onClick={() => { setShowImport(false); setImportFile(null); setImportPassword(''); }}>{t.common.cancel}</Button>
                                <Button onClick={handleImport} disabled={!importFile || busy}>{busy ? t.settings.importing : t.settings.importButton}</Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Language */}
            <Card className="animate-fade-in stagger-3">
                <CardHeader><CardTitle className="flex items-center gap-2"><Languages className="size-5" />{t.settings.languageTitle}</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                    {supportedLocales.map(l => (
                        <Button
                            key={l}
                            variant={locale === l ? 'default' : 'secondary'}
                            onClick={() => setLocale(l)}
                        >
                            {localeLabels[l]}
                        </Button>
                    ))}
                </CardContent>
            </Card>

            {/* Security */}
            <Card className="animate-fade-in stagger-4">
                <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />{t.settings.securityTitle}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                    {[t.settings.securityEd25519, t.settings.securitySigned, t.settings.securityRelay].map((text, i) => (
                        <div key={i} className="flex gap-3 text-sm text-[#716969]">
                            <KeyRound className="mt-0.5 size-4 shrink-0 text-[#004502]" />
                            <span>{text}</span>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Danger Zone */}
            <Card className="animate-fade-in border-red-200">
                <CardHeader><CardTitle className="text-red-700">{t.settings.dangerZone}</CardTitle><CardDescription>{t.settings.dangerZoneDesc}</CardDescription></CardHeader>
                <CardContent>
                <Button variant="destructive"
                    onClick={async () => {
                        if (confirm(t.settings.deleteConfirm)) {
                            await deleteIdentity();
                        }
                    }}
                >
                    <Trash2 className="size-4" />{t.settings.deleteAccount}
                </Button>
                </CardContent>
            </Card>
        </div>
    );
}
