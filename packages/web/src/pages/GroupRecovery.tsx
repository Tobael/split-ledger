import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import {
    type GroupId,
    type PublicKey,
    type RecoveryRequest,
    type CoSignature,
} from '@splitledger/core';

export function GroupRecovery() {
    const { id } = useParams<{ id: string }>();
    const groupId = id as GroupId;
    const { manager, getGroupState, identity, refreshGroups } = useApp();
    const { t } = useI18n();

    const [activeTab, setActiveTab] = useState<'recover' | 'help'>('recover');
    const [requestInput, setRequestInput] = useState('');
    const [signatureInput, setSignatureInput] = useState('');
    const [generatedRequest, setGeneratedRequest] = useState('');
    const [generatedSignature, setGeneratedSignature] = useState('');
    const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
    const [candidates, setCandidates] = useState<{ pubkey: string; name: string }[]>([]);

    useEffect(() => {
        getGroupState(groupId).then(state => {
            if (state && identity) {
                // Populate candidates for "Recover Me" (everyone except me... but I am new identity essentially)
                // Actually, I am recovering a *previous* identity. So I am currently a *new* identity (fresh install).
                // Or I am just adding a new device but lost root key?
                // Social recovery is about recovering the ROOT key.
                // If I lost my root key, I must have created a NEW root key to even use the app (onboarding).
                // So I want to take over my OLD member slot.
                // Candidates are all members.
                const list = [...state.members.values()].map(m => ({
                    pubkey: m.rootPubkey,
                    name: m.displayName,
                }));
                setCandidates(list);
            }
        });
    }, [groupId, getGroupState, identity]);

    const handleInitiate = async (targetPubkey: string) => {
        if (!manager) return;
        try {
            const req = manager.initiateRecovery(groupId, targetPubkey as PublicKey);
            const encoded = btoa(JSON.stringify(req));
            setGeneratedRequest(encoded);
            setStatus(null);
        } catch (err) {
            console.error(err);
            setStatus({ type: 'error', msg: 'Failed to initiate' });
        }
    };

    const handleSign = async () => {
        if (!manager || !requestInput) return;
        try {
            const req = JSON.parse(atob(requestInput)) as RecoveryRequest;
            const sig = manager.contributeRecoverySignature(req);
            const encoded = btoa(JSON.stringify(sig));
            setGeneratedSignature(encoded);
            setStatus(null);
        } catch (err) {
            console.error(err);
            setStatus({ type: 'error', msg: 'Invalid request' });
        }
    };

    const handleComplete = async () => {
        if (!manager || !generatedRequest || !signatureInput) return;
        try {
            const req = JSON.parse(atob(generatedRequest)) as RecoveryRequest;
            // Allow multiple signatures separated by newlines or just one
            const sigsRaw = signatureInput.split(/[\n\s]+/).filter(Boolean);
            const sigs = sigsRaw.map(s => JSON.parse(atob(s)) as CoSignature);

            await manager.completeRecovery(req, sigs);
            await refreshGroups();
            setStatus({ type: 'success', msg: 'Recovery successful! You have regained access.' });
            setTimeout(() => window.location.href = `/group/${groupId}`, 2000);
        } catch (err) {
            console.error(err);
            setStatus({ type: 'error', msg: 'Recovery failed. Need more signatures?' });
        }
    };

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="page-header">
                <Link to={`/group/${groupId}`} style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
                    ← {t.common.back}
                </Link>
                <h1 className="page-header__title" style={{ marginTop: 'var(--space-2)' }}>Social Recovery</h1>
                <p className="page-header__subtitle">Recover access with help from friends</p>
            </div>

            <div className="glass-card glass-card--static" style={{ padding: '0' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)' }}>
                    <button
                        className={`btn btn--ghost ${activeTab === 'recover' ? 'btn--active' : ''}`}
                        onClick={() => setActiveTab('recover')}
                        style={{ flex: 1, borderRadius: 0, borderBottom: activeTab === 'recover' ? '2px solid var(--accent-primary)' : 'none' }}
                    >
                        I lost my access
                    </button>
                    <button
                        className={`btn btn--ghost ${activeTab === 'help' ? 'btn--active' : ''}`}
                        onClick={() => setActiveTab('help')}
                        style={{ flex: 1, borderRadius: 0, borderBottom: activeTab === 'help' ? '2px solid var(--accent-primary)' : 'none' }}
                    >
                        Help a friend
                    </button>
                </div>

                <div style={{ padding: 'var(--space-6)' }}>
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

                    {activeTab === 'recover' ? (
                        <>
                            <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>1. Who were you?</h3>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
                                {candidates.map(c => (
                                    <button
                                        key={c.pubkey}
                                        className="btn btn--secondary btn--sm"
                                        onClick={() => handleInitiate(c.pubkey)}
                                    >
                                        {c.name}
                                    </button>
                                ))}
                            </div>

                            {generatedRequest && (
                                <>
                                    <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>2. Share this Request</h3>
                                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                                        Send this code to your friends in this group.
                                    </p>
                                    <textarea
                                        className="form-input"
                                        readOnly
                                        value={generatedRequest}
                                        onClick={e => e.currentTarget.select()}
                                        style={{ fontFamily: 'monospace', fontSize: '10px', height: '60px', marginBottom: 'var(--space-6)' }}
                                    />

                                    <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>3. Enter Signatures</h3>
                                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                                        Paste the codes your friends send back (one per line).
                                    </p>
                                    <textarea
                                        className="form-input"
                                        value={signatureInput}
                                        onChange={e => setSignatureInput(e.target.value)}
                                        placeholder="Paste signatures here..."
                                        style={{ fontFamily: 'monospace', fontSize: '10px', height: '80px', marginBottom: 'var(--space-4)' }}
                                    />

                                    <button className="btn btn--primary btn--full" onClick={handleComplete}>
                                        Recover Identity
                                    </button>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>1. Paste Request</h3>
                            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                                Paste the code your friend sent you.
                            </p>
                            <textarea
                                className="form-input"
                                value={requestInput}
                                onChange={e => setRequestInput(e.target.value)}
                                placeholder="Paste request here..."
                                style={{ fontFamily: 'monospace', fontSize: '10px', height: '60px', marginBottom: 'var(--space-4)' }}
                            />

                            <button className="btn btn--primary btn--full" onClick={handleSign} disabled={!requestInput}>
                                Sign & Help
                            </button>

                            {generatedSignature && (
                                <>
                                    <hr style={{ margin: 'var(--space-6) 0', border: 0, borderTop: '1px solid var(--glass-border)' }} />
                                    <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>2. Send back to friend</h3>
                                    <textarea
                                        className="form-input"
                                        readOnly
                                        value={generatedSignature}
                                        onClick={e => e.currentTarget.select()}
                                        style={{ fontFamily: 'monospace', fontSize: '10px', height: '60px' }}
                                    />
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
