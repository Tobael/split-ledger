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
import type { GroupId, PublicKey } from '@splitledger/core';

export function Settings() {
    const {
        identity, restoreIdentity, deleteIdentity, groups, getGroupState, manager, broadcastEntry,
        refreshGroups, personalGroupId, getAuthorizedDevicesV2, revokeDeviceV2,
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
            for (const g of groups.filter(({ protocolVersion }) => protocolVersion === 1)) {
                const state = await getGroupState(g.groupId);
                if (!state) continue;
                const me = state.members.get(identity.rootKeyPair.publicKey);
                if (me) {
                    me.authorizedDevices.forEach(dKey => {
                        const existing = devices.get(dKey) || {
                            name: dKey === identity.device.deviceKeyPair.publicKey
                                ? identity.device.deviceName
                                : (me.deviceNames?.get(dKey) || t.settings.unknownDevice),
                            groups: [] as GroupId[]
                        };
                        if (dKey === identity.device.deviceKeyPair.publicKey) existing.name = identity.device.deviceName; // Ensure my device name is correct
                        if (!existing.groups.includes(g.groupId)) existing.groups.push(g.groupId);
                        devices.set(dKey, existing);
                    });
                }
            }
            setAuthorizedDevices(devices);
        };
        loadDevices();
    }, [groups, identity, getAuthorizedDevicesV2, getGroupState, t.settings.unknownDevice]);

    const handleRevoke = async (deviceKey: string, groupIds: GroupId[]) => {
        if (!manager || !confirm(t.settings.confirmRevoke)) return;
        setBusy(true);
        setStatus(null);
        try {
            await revokeDeviceV2(deviceKey);
            const legacyGroupIds = groupIds.filter((groupId) =>
                groups.some((group) => group.groupId === groupId && group.protocolVersion === 1));
            const allGroupsToRevoke = personalGroupId ? [...legacyGroupIds, personalGroupId] : legacyGroupIds;
            for (const gid of Array.from(new Set(allGroupsToRevoke))) {
                try {
                    const entry = await manager.revokeDevice(gid, deviceKey as PublicKey, 'Revoked by user');
                    await broadcastEntry(gid, entry);
                } catch (e) {
                    console.error(`Failed to revoke in group ${gid}`, e);
                }
            }
            await refreshGroups(); // will trigger useEffect to reload devices
            setStatus({ type: 'success', msg: 'Device revoked' });
        } catch {
            setStatus({ type: 'error', msg: 'Failed to revoke device' });
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
            setStatus({ type: 'error', msg: 'Export failed' });
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

            // Broadcast to all active groups
            if (manager) {
                const activeGroupIds = await manager.listGroups();
                for (const gid of activeGroupIds) {
                    if (gid !== personalGroupId) {
                        try {
                            const entry = await manager.renameMember(gid, newName);
                            await broadcastEntry(gid, entry);
                        } catch (e) {
                            console.error(`Failed to rename in group ${gid}`, e);
                        }
                    }
                }
            }

            setStatus({ type: 'success', msg: t.settings.renameSuccess || 'Name updated' });
            setIsEditingName(false);
        } catch {
            setStatus({ type: 'error', msg: 'Failed to update name' });
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

    const sectionHeading = { fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' };
    const cardStyle = { padding: 'var(--space-6)', marginBottom: 'var(--space-4)' };

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="page-header">
                <h1 className="page-header__title">{t.settings.title}</h1>
                <p className="page-header__subtitle">{t.settings.subtitle}</p>
            </div>

            {/* Status banner */}
            {status && (
                <div style={{
                    padding: 'var(--space-3) var(--space-4)',
                    background: status.type === 'success' ? 'var(--accent-primary-dim)' : 'var(--danger-dim)',
                    borderRadius: 'var(--radius-md)',
                    color: status.type === 'success' ? 'var(--accent-primary)' : 'var(--danger)',
                    fontSize: 'var(--font-size-sm)',
                    marginBottom: 'var(--space-4)',
                }}>
                    {status.msg}
                </div>
            )}

            {/* Identity */}
            <div className="glass-card glass-card--static animate-fade-in" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.identityTitle}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>{t.settings.displayNameLabel}</div>
                        {isEditingName ? (
                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                <input
                                    className="form-input"
                                    value={editNameValue}
                                    onChange={e => setEditNameValue(e.target.value)}
                                    disabled={busy}
                                    autoFocus
                                    onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                                />
                                <button className="btn btn--primary" onClick={handleSaveName} disabled={busy || !editNameValue.trim()}>Save</button>
                                <button className="btn btn--ghost" onClick={() => { setIsEditingName(false); setEditNameValue(identity.displayName); }} disabled={busy}>Cancel</button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontWeight: 600 }}>{identity.displayName}</div>
                                <button className="btn btn--secondary btn--sm" onClick={() => setIsEditingName(true)}>Edit</button>
                            </div>
                        )}
                    </div>
                    <div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>{t.settings.rootKeyLabel}</div>
                        <code style={{
                            padding: 'var(--space-2) var(--space-3)',
                            background: 'var(--bg-primary)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--accent-primary)',
                            display: 'block',
                        }}>
                            {pubkeyShort}
                        </code>
                    </div>
                </div>
            </div>

            <div className="glass-card glass-card--static animate-fade-in stagger-1" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.relayTitle}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-4)' }}>
                    {t.settings.relayDescription}
                </p>
                <label className="form-label" htmlFor="relay-url">{t.settings.relayUrlLabel}</label>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <input
                        id="relay-url"
                        className="form-input"
                        type="url"
                        inputMode="url"
                        value={relayUrl}
                        onChange={(event) => setRelayUrl(event.target.value)}
                        placeholder="wss://relay.example.org/ws"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <button className="btn btn--primary" type="button" onClick={handleSaveRelay}>
                        {t.common.save}
                    </button>
                </div>
            </div>

            {/* Device */}
            <div className="glass-card glass-card--static animate-fade-in stagger-1" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.deviceTitle}</h3>

                {/* Current Device */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                    <div>
                        <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                            {identity.device.deviceName} <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>({t.settings.thisDevice})</span>
                        </div>
                        <code style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{devicePubkeyShort}</code>
                    </div>
                    <span className="badge badge--positive">{t.common.active}</span>
                </div>

                {/* Other Devices */}
                {authorizedDevices.size > 1 && (
                    <>
                        <h4 style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)', textTransform: 'uppercase' }}>{t.settings.authorizedDevices}</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                            {[...authorizedDevices.entries()].filter(([k]) => k !== identity.device.deviceKeyPair.publicKey).map(([key, data]) => (
                                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3)', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
                                    <div style={{ overflow: 'hidden' }}>
                                        <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.name}</div>
                                        <code style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', display: 'block' }}>{key.slice(0, 8)}…{key.slice(-8)}</code>
                                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{data.groups.length} groups</div>
                                    </div>
                                    <button
                                        className="btn btn--secondary btn--sm"
                                        style={{ color: 'var(--danger)', borderColor: 'var(--danger-dim)' }}
                                        onClick={() => handleRevoke(key, data.groups)}
                                        disabled={busy}
                                    >
                                        {t.settings.revoke}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Account Transfer */}
            <div className="glass-card glass-card--static animate-fade-in stagger-2" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.transferTitle}</h3>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
                    {t.settings.transferDescription}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {/* Identity Export QR Code */}
                    <IdentityExport />

                    {/* Export File */}
                    {!showExport ? (
                        <button className="btn btn--secondary" onClick={() => { setShowExport(true); setShowImport(false); setStatus(null); }}>
                            {t.settings.exportButton}
                        </button>
                    ) : (
                        <div style={{
                            padding: 'var(--space-4)',
                            background: 'var(--bg-primary)',
                            borderRadius: 'var(--radius-md)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--space-3)',
                        }}>
                            <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                                {t.settings.passwordPrompt}
                            </label>
                            <input
                                className="form-input"
                                type="password"
                                value={exportPassword}
                                onChange={e => setExportPassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleExport()}
                                autoFocus
                                placeholder="••••••"
                            />
                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                <button className="btn btn--ghost" onClick={() => { setShowExport(false); setExportPassword(''); }} style={{ flex: 1 }}>
                                    {t.common.cancel}
                                </button>
                                <button className="btn btn--primary" onClick={handleExport} disabled={busy} style={{ flex: 1 }}>
                                    {busy ? t.settings.exporting : t.settings.exportButton}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Import File */}
                    {!showImport ? (
                        <button className="btn btn--secondary" onClick={() => { setShowImport(true); setShowExport(false); setStatus(null); }}>
                            {t.settings.importButton}
                        </button>
                    ) : (
                        <div style={{
                            padding: 'var(--space-4)',
                            background: 'var(--bg-primary)',
                            borderRadius: 'var(--radius-md)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--space-3)',
                        }}>
                            <div style={{
                                padding: 'var(--space-3) var(--space-4)',
                                background: 'var(--danger-dim)',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 'var(--font-size-xs)',
                                color: 'var(--danger)',
                            }}>
                                ⚠️ {t.settings.importWarning}
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json"
                                onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                                style={{ fontSize: 'var(--font-size-sm)' }}
                            />
                            {importFile && (
                                <>
                                    <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                                        {t.settings.passwordPrompt}
                                    </label>
                                    <input
                                        className="form-input"
                                        type="password"
                                        value={importPassword}
                                        onChange={e => setImportPassword(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleImport()}
                                        placeholder="••••••"
                                    />
                                </>
                            )}
                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                <button className="btn btn--ghost" onClick={() => { setShowImport(false); setImportFile(null); setImportPassword(''); }} style={{ flex: 1 }}>
                                    {t.common.cancel}
                                </button>
                                <button className="btn btn--primary" onClick={handleImport} disabled={!importFile || busy} style={{ flex: 1 }}>
                                    {busy ? t.settings.importing : t.settings.importButton}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Language */}
            <div className="glass-card glass-card--static animate-fade-in stagger-3" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.languageTitle}</h3>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    {supportedLocales.map(l => (
                        <button
                            key={l}
                            className={`btn ${locale === l ? 'btn--primary' : 'btn--secondary'}`}
                            onClick={() => setLocale(l)}
                            style={{ flex: 1 }}
                        >
                            {localeLabels[l]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Security */}
            <div className="glass-card glass-card--static animate-fade-in stagger-4" style={cardStyle}>
                <h3 style={sectionHeading}>{t.settings.securityTitle}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {[
                        ['🔐', t.settings.securityEd25519],
                        ['📋', t.settings.securitySigned],
                        ['🌐', t.settings.securityRelay],
                    ].map(([icon, text], i) => (
                        <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                            <span>{icon}</span>
                            <span>{text}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Danger Zone */}
            <div className="glass-card glass-card--static animate-fade-in stagger-4" style={{ ...cardStyle, border: '1px solid var(--danger-dim)' }}>
                <h3 style={{ ...sectionHeading, color: 'var(--danger)' }}>{t.settings.dangerZone}</h3>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
                    {t.settings.dangerZoneDesc}
                </p>
                <button
                    className="btn btn--secondary"
                    style={{ color: 'var(--danger)', borderColor: 'var(--danger-dim)' }}
                    onClick={async () => {
                        if (confirm(t.settings.deleteConfirm)) {
                            await deleteIdentity();
                        }
                    }}
                >
                    {t.settings.deleteAccount}
                </button>
            </div>
        </div>
    );
}
