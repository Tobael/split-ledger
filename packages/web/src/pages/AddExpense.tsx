import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import {
    type GroupId,
    type GroupState,
    type PublicKey,
    EntryType,
    buildEntry,
} from '@splitledger/core';

export function AddExpense() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { manager, getGroupState, storage, identity, refreshGroups, broadcastEntry } = useApp();
    const { t } = useI18n();
    const groupId = id as GroupId;

    const [state, setState] = useState<GroupState | null>(null);
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState('EUR');
    const [paidBy, setPaidBy] = useState<string>('');
    const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal');
    const [customSplits, setCustomSplits] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        getGroupState(groupId).then((s) => {
            if (s) {
                setState(s);
                if (identity) setPaidBy(identity.rootKeyPair.publicKey);
            }
        });
    }, [groupId, getGroupState, identity]);

    if (!state || !identity) {
        return <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>{t.common.loading}</div>;
    }

    const activeMembers = [...state.members.values()].filter(m => m.isActive);

    const handleSubmit = async () => {
        if (!manager || !description.trim() || !amount || !paidBy) return;
        setError('');
        setSubmitting(true);

        try {
            const amountMinor = Math.round(parseFloat(amount) * 100);
            if (amountMinor <= 0 || isNaN(amountMinor)) {
                setError(t.addExpense.invalidAmount);
                setSubmitting(false);
                return;
            }

            let splits: Record<string, number>;
            if (splitMode === 'equal') {
                const perPerson = Math.floor(amountMinor / activeMembers.length);
                const remainder = amountMinor - perPerson * activeMembers.length;
                splits = {};
                activeMembers.forEach((m, i) => {
                    splits[m.rootPubkey] = perPerson + (i < remainder ? 1 : 0);
                });
            } else {
                splits = {};
                let total = 0;
                for (const m of activeMembers) {
                    const val = Math.round(parseFloat(customSplits[m.rootPubkey] || '0') * 100);
                    splits[m.rootPubkey] = val;
                    total += val;
                }
                if (total !== amountMinor) {
                    setError(t.addExpense.splitMismatch((total / 100).toFixed(2), (amountMinor / 100).toFixed(2)));
                    setSubmitting(false);
                    return;
                }
            }

            const entries = await storage.getAllEntries(groupId);
            const { orderEntries, validateFullChain } = await import('@splitledger/core');
            const ordered = orderEntries([...entries]);
            const latestEntry = ordered[ordered.length - 1]!;
            const result = validateFullChain(entries);
            if (!result.valid || !result.finalState) {
                setError(t.addExpense.invalidLedger);
                setSubmitting(false);
                return;
            }

            const entry = buildEntry(
                EntryType.ExpenseCreated,
                {
                    description: description.trim(),
                    amountMinorUnits: amountMinor,
                    currency,
                    paidByRootPubkey: paidBy as PublicKey,
                    splits,
                },
                latestEntry.entryId,
                result.finalState.currentLamportClock + 1,
                identity.device.deviceKeyPair.publicKey,
                identity.device.deviceKeyPair.secretKey,
            );

            await storage.appendEntry(groupId, entry);
            await broadcastEntry(groupId, entry);
            await refreshGroups();
            navigate(`/group/${groupId}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add expense');
            setSubmitting(false);
        }
    };

    return (
        <div style={{ maxWidth: '520px', margin: '0 auto' }}>
            <div className="page-header">
                <Link to={`/group/${groupId}`} style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>{t.addExpense.backTo} {state.groupName}</Link>
                <h1 className="page-header__title" style={{ marginTop: 'var(--space-2)' }}>{t.addExpense.title}</h1>
            </div>

            <div className="glass-card glass-card--static animate-fade-in" style={{ padding: 'var(--space-6)' }}>
                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                    <label className="form-label">{t.addExpense.descriptionLabel}</label>
                    <input className="form-input" type="text" placeholder={t.addExpense.descriptionPlaceholder} value={description} onChange={e => setDescription(e.target.value)} autoFocus />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                    <div className="form-group">
                        <label className="form-label">{t.addExpense.amountLabel}</label>
                        <input className="form-input" type="number" step="0.01" min="0" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">{t.addExpense.currencyLabel}</label>
                        <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
                            <option value="EUR">EUR</option>
                            <option value="USD">USD</option>
                            <option value="GBP">GBP</option>
                            <option value="CHF">CHF</option>
                            <option value="JPY">JPY</option>
                        </select>
                    </div>
                </div>

                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                    <label className="form-label">{t.addExpense.paidByLabel}</label>
                    <select className="form-input" value={paidBy} onChange={e => setPaidBy(e.target.value)}>
                        {activeMembers.map(m => (
                            <option key={m.rootPubkey} value={m.rootPubkey}>
                                {m.displayName}{m.rootPubkey === identity.rootKeyPair.publicKey ? ` (${t.common.you})` : ''}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                    <label className="form-label">{t.addExpense.splitLabel}</label>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button className={`btn ${splitMode === 'equal' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => setSplitMode('equal')} style={{ flex: 1 }}>{t.addExpense.equal}</button>
                        <button className={`btn ${splitMode === 'custom' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => setSplitMode('custom')} style={{ flex: 1 }}>{t.addExpense.custom}</button>
                    </div>
                </div>

                {splitMode === 'custom' && (
                    <div style={{ marginBottom: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {activeMembers.map(m => (
                            <div key={m.rootPubkey} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                <span style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}>{m.displayName}</span>
                                <input className="form-input" type="number" step="0.01" min="0" placeholder="0.00"
                                    value={customSplits[m.rootPubkey] || ''}
                                    onChange={e => setCustomSplits(prev => ({ ...prev, [m.rootPubkey]: e.target.value }))}
                                    style={{ width: '120px' }} />
                            </div>
                        ))}
                    </div>
                )}

                {splitMode === 'equal' && amount && parseFloat(amount) > 0 && (
                    <div style={{
                        padding: 'var(--space-3) var(--space-4)',
                        background: 'var(--accent-primary-dim)',
                        borderRadius: 'var(--radius-md)',
                        marginBottom: 'var(--space-4)',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--accent-primary)',
                    }}>
                        {t.addExpense.splitEqually} €{(parseFloat(amount) / activeMembers.length).toFixed(2)} {t.addExpense.perPerson}
                    </div>
                )}

                {error && (
                    <div style={{
                        padding: 'var(--space-3) var(--space-4)',
                        background: 'var(--danger-dim)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--danger)',
                        fontSize: 'var(--font-size-sm)',
                        marginBottom: 'var(--space-4)',
                    }}>
                        {error}
                    </div>
                )}

                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn btn--ghost" onClick={() => navigate(`/group/${groupId}`)}>{t.common.cancel}</button>
                    <button className="btn btn--primary btn--full" onClick={handleSubmit} disabled={!description.trim() || !amount || submitting}>
                        {submitting ? t.addExpense.adding : t.addExpense.addButton}
                    </button>
                </div>
            </div>
        </div>
    );
}
