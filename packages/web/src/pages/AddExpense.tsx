import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import {
    type GroupId,
    type GroupState,
    type GroupStateV2,
    type PublicKey,
    type Hash,
    EntryType,
    buildEntry,
    getEffectiveExpenses,
} from '@splitledger/core';
import { equalParticipantSplits } from '../utils/expense-splits';

export function AddExpense() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const editId = searchParams.get('edit');

    const {
        manager, getGroupState, getGroupStateV2, storage, identity, refreshGroup, broadcastEntry,
        correctExpense, createExpenseV2, correctExpenseV2,
    } = useApp();
    const { t } = useI18n();
    const groupId = id as GroupId;

    const [state, setState] = useState<GroupState | null>(null);
    const [stateV2, setStateV2] = useState<GroupStateV2 | null>(null);
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [paidBy, setPaidBy] = useState<string>('');
    const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal');
    const [customSplits, setCustomSplits] = useState<Record<string, string>>({});
    const [excludedParticipants, setExcludedParticipants] = useState<Set<string>>(() => new Set());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        void (async () => {
            const v2 = await getGroupStateV2(groupId);
            if (v2) {
                setStateV2(v2);
                if (editId) {
                    const projected = v2.expenses[editId];
                    if (projected?.status === 'effective') {
                        const expense = projected.expense;
                        setDescription(String(expense.description));
                        setAmount((Number(expense.amountMinorUnits) / 100).toFixed(2));
                        setPaidBy(String(expense.paidBy));
                        setSplitMode('custom');
                        setCustomSplits(Object.fromEntries(
                            Object.entries(expense.splits as Record<string, number>)
                                .map(([participantId, share]) => [participantId, (share / 100).toFixed(2)]),
                        ));
                        setExcludedParticipants(new Set(
                            Object.entries(expense.splits as Record<string, number>)
                                .filter(([, share]) => share === 0)
                                .map(([participantId]) => participantId),
                        ));
                    }
                } else if (identity) {
                    const mine = Object.values(v2.participants).find(
                        ({ claimedRootPublicKey }) => claimedRootPublicKey === identity.rootKeyPair.publicKey,
                    );
                    if (mine) setPaidBy(mine.participantId);
                }
                return;
            }
            const legacy = await getGroupState(groupId);
            if (legacy) {
                setState(legacy);
                if (!editId && identity) setPaidBy(identity.rootKeyPair.publicKey);
            }
        })();
    }, [groupId, getGroupState, getGroupStateV2, identity, editId]);

    // Load entry if editing
    useEffect(() => {
        if (stateV2) return;
        if (!editId || !storage) return;
        storage.getAllEntries(groupId).then(entries => {
            const entry = entries.find(candidate => candidate.entryId === editId);
            if (entry && entry.entryType === EntryType.ExpenseCreated) {
                const p = getEffectiveExpenses(entries).get(entry.entryId) ?? entry.payload;
                setDescription(p.description);
                setAmount((p.amountMinorUnits / 100).toFixed(2));
                setPaidBy(p.paidByRootPubkey);

                // Determine split mode
                // (Simplification: if custom splits match equal logic, we could set equal, but keeping custom is safer for exact reproduction)
                // Actually, let's try to detect if it's equal to default behaviors, but 'custom' is safe.
                setSplitMode('custom');
                const humanSplits: Record<string, string> = {};
                for (const [k, v] of Object.entries(p.splits)) {
                    humanSplits[k] = (v / 100).toFixed(2);
                }
                setCustomSplits(humanSplits);
                setExcludedParticipants(new Set(
                    Object.entries(p.splits)
                        .filter(([, share]) => share === 0)
                        .map(([participantId]) => participantId),
                ));
            }
        });
    }, [editId, storage, groupId, stateV2]);

    if ((!state && !stateV2) || !identity) {
        return <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>{t.common.loading}</div>;
    }

    const activeMembers = stateV2
        ? Object.values(stateV2.participants)
            .filter(({ status }) => status !== 'disabled')
            .map((participant) => ({ id: participant.participantId, displayName: participant.displayName, isMe: participant.claimedRootPublicKey === identity.rootKeyPair.publicKey }))
        : [...state!.members.values()]
            .filter((member) => member.isActive)
            .map((member) => ({ id: member.rootPubkey, displayName: member.displayName, isMe: member.rootPubkey === identity.rootKeyPair.publicKey }));

    const prefillCustomSplits = (excluded: ReadonlySet<string>, nextAmount = amount) => {
        const amountMinor = Math.round(parseFloat(nextAmount || '0') * 100);
        const eligible = activeMembers.filter(({ id: participantId }) => !excluded.has(participantId));
        if (!Number.isFinite(amountMinor) || amountMinor <= 0 || eligible.length === 0) {
            setCustomSplits(Object.fromEntries(activeMembers.map(({ id }) => [id, '0.00'])));
            return;
        }
        const shares = equalParticipantSplits(activeMembers.map(({ id }) => id), amountMinor, excluded);
        setCustomSplits(Object.fromEntries(
            Object.entries(shares).map(([participantId, share]) => [participantId, (share / 100).toFixed(2)]),
        ));
    };

    const chooseCustomMode = () => {
        setSplitMode('custom');
        if (Object.keys(customSplits).length === 0) prefillCustomSplits(excludedParticipants);
    };

    const toggleParticipantEligibility = (participantId: string) => {
        const next = new Set(excludedParticipants);
        if (next.has(participantId)) next.delete(participantId);
        else {
            const eligibleCount = activeMembers.filter(({ id }) => !next.has(id)).length;
            if (eligibleCount <= 1) return;
            next.add(participantId);
        }
        setExcludedParticipants(next);
        prefillCustomSplits(next);
    };

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
                splits = equalParticipantSplits(activeMembers.map(({ id }) => id), amountMinor);
            } else {
                splits = {};
                let total = 0;
                for (const m of activeMembers) {
                    const val = Math.round(parseFloat(customSplits[m.id] || '0') * 100);
                    splits[m.id] = val;
                    total += val;
                }
                if (total !== amountMinor) {
                    setError(t.addExpense.splitMismatch((total / 100).toFixed(2), (amountMinor / 100).toFixed(2)));
                    setSubmitting(false);
                    return;
                }
            }

            if (stateV2) {
                const expense = {
                    description: description.trim(),
                    amountMinorUnits: amountMinor,
                    currency: 'EUR',
                    paidBy,
                    splits,
                };
                if (editId) await correctExpenseV2(groupId, editId, expense, 'Expense edited');
                else await createExpenseV2(groupId, expense);
                navigate(`/group/${groupId}`);
                return;
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

            if (editId) {
                await correctExpense(groupId, editId as Hash, {
                    description: description.trim(),
                    amountMinorUnits: amountMinor,
                    currency: 'EUR',
                    paidByRootPubkey: paidBy as PublicKey,
                    splits,
                });
                navigate(`/group/${groupId}`);
                return;
            }

            const entry = buildEntry(
                EntryType.ExpenseCreated,
                {
                    description: description.trim(),
                    amountMinorUnits: amountMinor,
                    currency: 'EUR',
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
            await refreshGroup(groupId); // Optimistic/Local refresh only
            navigate(`/group/${groupId}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add expense');
            setSubmitting(false);
        }
    };

    return (
        <div style={{ maxWidth: '520px', margin: '0 auto' }}>
            <div className="page-header">
                <Link to={`/group/${groupId}`} style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>{t.addExpense.backTo} {stateV2?.groupName ?? state?.groupName}</Link>
                <h1 className="page-header__title" style={{ marginTop: 'var(--space-2)' }}>{editId ? 'Edit Expense' : t.addExpense.title}</h1>
            </div>

            <div className="glass-card glass-card--static animate-fade-in" style={{ padding: 'var(--space-6)' }}>
                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                    <label className="form-label">{t.addExpense.descriptionLabel}</label>
                    <input className="form-input" type="text" placeholder={t.addExpense.descriptionPlaceholder} value={description} onChange={e => setDescription(e.target.value)} autoFocus />
                </div>

                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                    <label className="form-label">{t.addExpense.amountLabel}</label>
                    <input className="form-input" type="number" step="0.01" min="0" placeholder="0.00" value={amount} onChange={e => {
                        setAmount(e.target.value);
                        if (splitMode === 'custom') prefillCustomSplits(excludedParticipants, e.target.value);
                    }} />
                </div>

                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                    <label className="form-label">{t.addExpense.paidByLabel}</label>
                    <select className="form-input" value={paidBy} onChange={e => setPaidBy(e.target.value)}>
                        {activeMembers.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.displayName}{m.isMe ? ` (${t.common.you})` : ''}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                    <label className="form-label">{t.addExpense.splitLabel}</label>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button className={`btn ${splitMode === 'equal' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => setSplitMode('equal')} style={{ flex: 1 }}>{t.addExpense.equal}</button>
                        <button className={`btn ${splitMode === 'custom' ? 'btn--primary' : 'btn--secondary'}`} onClick={chooseCustomMode} style={{ flex: 1 }}>{t.addExpense.custom}</button>
                    </div>
                </div>

                {splitMode === 'custom' && (
                    <div style={{ marginBottom: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>{t.addExpense.customSplitHelp}</p>
                        {activeMembers.map(m => (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                <button
                                    type="button"
                                    className={`btn btn--sm ${excludedParticipants.has(m.id) ? 'btn--ghost' : 'btn--secondary'}`}
                                    style={{ flex: 1, justifyContent: 'flex-start' }}
                                    onClick={() => toggleParticipantEligibility(m.id)}
                                    aria-pressed={!excludedParticipants.has(m.id)}
                                >
                                    {m.displayName} · {excludedParticipants.has(m.id) ? t.addExpense.excluded : t.addExpense.eligible}
                                </button>
                                <input className="form-input" type="number" step="0.01" min="0" placeholder="0.00"
                                    value={customSplits[m.id] || ''}
                                    onChange={e => setCustomSplits(prev => ({ ...prev, [m.id]: e.target.value }))}
                                    disabled={excludedParticipants.has(m.id)}
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
