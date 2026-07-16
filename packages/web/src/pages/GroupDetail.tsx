import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { ChainVisualization } from '../components/ChainVisualization';
import {
    type GroupState,
    type LedgerEntry,
    type GroupId,
    type GroupStateV2,
    type PublicKey,
    EntryType,
    computeBalances,
    computeSettlements,
    buildEntry,
    orderEntries,
    validateFullChain,
    getEffectiveExpenses,
} from '@splitledger/core';
import { ArrowRight, Check, Copy, Link2, Pencil, RotateCcw, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function GroupDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const { manager, getGroupState, getGroupStateV2, getGroupEntries, identity, broadcastEntry, refreshGroups, storage, deleteGroup, lastUpdate, groupsWaitingForHistory } = useApp();
    const { t } = useI18n();
    const groupId = id as GroupId;
    const waitingForHistory = groupsWaitingForHistory.has(groupId);

    const [state, setState] = useState<GroupState | null>(null);
    const [stateV2, setStateV2] = useState<GroupStateV2 | null>(null);
    const [entries, setEntries] = useState<LedgerEntry[]>([]);
    const [inviteLink, setInviteLink] = useState('');
    const [showInvite, setShowInvite] = useState(false);
    const [copied, setCopied] = useState(false);
    const [showChain, setShowChain] = useState(false);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        if (!manager) return;
        try {
            const v2 = await getGroupStateV2(groupId);
            if (v2) {
                setStateV2(v2);
                setState(null);
                setEntries([]);
                return;
            }
            const s = await getGroupState(groupId);
            const e = await getGroupEntries(groupId);
            setState(s);
            setEntries(e);
        } finally {
            setLoading(false);
        }
    }, [groupId, getGroupState, getGroupStateV2, getGroupEntries, manager]);

    useEffect(() => {
        if (manager) {
            refresh();
        }
    }, [manager, refresh, lastUpdate]);

    const handleCreateInvite = () => {
        if (!manager) return;
        const token = manager.createInviteLink(groupId);
        const link = `${window.location.origin}/invite/${encodeURIComponent(token)}`;
        setInviteLink(link);
        setShowInvite(true);
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(inviteLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleRemoveMember = async (memberPubkey: string) => {
        if (!manager || !confirm(t.groupDetail.confirmRemove)) return;
        try {
            const entry = await manager.removeMember(groupId, memberPubkey as PublicKey, 'Removed by admin');
            await broadcastEntry(groupId, entry);
            await refresh();
            await refreshGroups();
        } catch (err) {
            console.error('Failed to remove member:', err);
            alert('Failed to remove member');
        }
    };

    const handleDeleteGroup = async () => {
        if (!confirm(t.groupDetail.confirmDelete ?? 'Are you sure you want to delete this group? This cannot be undone.')) return;
        try {
            await deleteGroup(groupId);
            navigate('/dashboard');
        } catch (err) {
            console.error('Failed to delete group:', err);
            alert('Failed to delete group');
        }
    };

    const handleSettleUp = async (from: string, to: string, amount: number) => {
        if (!manager || !identity || !storage) return;
        if (!confirm(t.groupDetail.confirmSettleUp ?? 'Are you sure you want to mark this as paid?')) return;
        try {
            // Get latest state for chaining
            const entries = await storage.getAllEntries(groupId);
            const ordered = orderEntries([...entries]);
            const latestEntry = ordered[ordered.length - 1]!;
            const result = validateFullChain(entries);

            if (!result.valid || !result.finalState) {
                alert(t.addExpense?.invalidLedger ?? 'Invalid ledger state');
                return;
            }

            const currency = getCurrency(entries);

            const entry = buildEntry(
                EntryType.ExpenseCreated,
                {
                    description: t.groupDetail.settlementDescription,
                    amountMinorUnits: amount,
                    currency,
                    paidByRootPubkey: from as PublicKey, // Debtor pays
                    splits: { [to]: amount }, // Creditor receives/consumes full amount
                    isSettlement: true,
                },
                latestEntry.entryId,
                result.finalState.currentLamportClock + 1,
                identity.device.deviceKeyPair.publicKey,
                identity.device.deviceKeyPair.secretKey,
            );

            await storage.appendEntry(groupId, entry);
            await broadcastEntry(groupId, entry);
            await refresh();
        } catch (err) {
            console.error('Failed to settle up:', err);
            alert('Failed to settle up');
        }
    };

    if (loading || !manager) {
        return <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>{t.common.loading}</div>;
    }

    if (stateV2) {
        return <ProtocolV2GroupDetail state={stateV2} onDelete={handleDeleteGroup} />;
    }

    if (!state) {
        if (waitingForHistory) {
            return (
                <div className="empty-state animate-fade-in" role="status">
                    <div className="empty-state__icon">⏳</div>
                    <h2 className="empty-state__title">{t.groupDetail.waitingForMemberTitle}</h2>
                    <p className="empty-state__text">{t.groupDetail.waitingForMemberText}</p>
                    <Link to="/dashboard" className="btn btn--secondary">{t.groupDetail.backToGroups}</Link>
                </div>
            );
        }
        return (
            <div className="empty-state animate-fade-in">
                <div className="empty-state__icon">🚫</div>
                <h2 className="empty-state__title">{t.groupDetail?.accessDeniedTitle ?? 'Access Denied'}</h2>
                <p className="empty-state__text">
                    {t.groupDetail?.accessDeniedText ?? 'You are not a member of this group or the group does not exist locally.'}
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                    <Link to="/dashboard" className="btn btn--secondary">
                        {t.groupDetail.backToGroups}
                    </Link>
                    <Link to="/join" className="btn btn--primary">
                        {t.dashboard.joinGroup}
                    </Link>
                </div>
            </div>
        );
    }

    const activeMembers = [...state.members.values()].filter(m => m.isActive);
    const balances = computeBalances(entries);
    const myPubkey = identity?.rootKeyPair.publicKey;

    const effectiveExpenses = getEffectiveExpenses(entries);
    const expenses = entries
        .filter(e => e.entryType === EntryType.ExpenseCreated && effectiveExpenses.has(e.entryId))
        .map(e => ({ entry: e, payload: effectiveExpenses.get(e.entryId)! }));
    const totalGroupExpenses = Array.from(effectiveExpenses.values())
        .filter(e => !e.isSettlement && e.description !== t.groupDetail.settlementDescription && e.description !== 'Settlement' && e.description !== 'Ausgleich' && e.description !== 'settlement')
        .reduce((sum, e) => sum + e.amountMinorUnits, 0);

    return (
        <div className="animate-fade-in">
            {/* Header */}
            {waitingForHistory && (
                <div role="status" style={{ padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-4)', background: 'var(--warning-dim)', color: 'var(--warning)', borderRadius: 'var(--radius-md)' }}>
                    <strong>{t.groupDetail.waitingForMemberTitle}</strong> {t.groupDetail.waitingForMemberText}
                </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
                <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-1)' }}>
                        <Link to="/dashboard" style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>{t.groupDetail.backToGroups}</Link>
                    </div>
                    <h1 className="page-header__title">{state.groupName}</h1>
                    <p className="page-header__subtitle">{activeMembers.length} {activeMembers.length === 1 ? t.common.member : t.common.members}</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <button className="btn btn--ghost" onClick={() => setShowChain(v => !v)}>{showChain ? t.groupDetail.hideChain : t.groupDetail.viewChain}</button>
                    <button className="btn btn--secondary" onClick={handleCreateInvite}>{t.groupDetail.invite}</button>
                    <Link to={`/group/${groupId}/expense`} className="btn btn--primary" style={{ flex: 1, minWidth: '140px' }}>{t.groupDetail.addExpense}</Link>
                </div>
            </div>

            {/* Invite modal */}
            {showInvite && (
                <div className="glass-card glass-card--static animate-fade-in" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                        <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600 }}>{t.groupDetail.inviteLinkTitle}</h3>
                        <button className="btn btn--ghost" onClick={() => setShowInvite(false)} style={{ padding: 'var(--space-1) var(--space-2)' }}>✕</button>
                    </div>
                    <div style={{
                        padding: 'var(--space-3)',
                        background: 'var(--bg-primary)',
                        borderRadius: 'var(--radius-sm)',
                        fontFamily: 'monospace',
                        fontSize: 'var(--font-size-xs)',
                        wordBreak: 'break-all',
                        color: 'var(--text-secondary)',
                        marginBottom: 'var(--space-3)',
                        maxHeight: '80px',
                        overflow: 'auto',
                    }}>
                        {inviteLink}
                    </div>
                    <button className="btn btn--secondary btn--full" onClick={handleCopy}>
                        {copied ? t.common.copied : `📋 ${t.common.copy}`}
                    </button>
                </div>
            )}

            {/* Chain Visualization */}
            {showChain && (
                <ChainVisualization
                    entries={entries}
                    memberNames={new Map(activeMembers.map(m => [m.rootPubkey, m.displayName]))}
                />
            )}

            {/* Grid: Members + Balances */}
            <div className="grid-responsive-cards" style={{ marginBottom: 'var(--space-6)' }}>
                {/* Members */}
                <div className="glass-card glass-card--static" style={{ padding: 'var(--space-5)' }}>
                    <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.groupDetail.membersTitle}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        {activeMembers.map((m) => {
                            const isMe = m.rootPubkey === myPubkey;
                            const initial = m.displayName.charAt(0).toUpperCase();
                            const colorHash = hashColor(m.rootPubkey);
                            return (
                                <div key={m.rootPubkey} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                    <div className="avatar avatar--sm" style={{ background: colorHash }}>{initial}</div>
                                    <span style={{ fontSize: 'var(--font-size-sm)' }}>
                                        {m.displayName}
                                        {isMe && <span style={{ color: 'var(--accent-primary)', marginLeft: 'var(--space-1)' }}>({t.common.you})</span>}
                                    </span>
                                    {m.rootPubkey === state.creatorRootPubkey && (
                                        <span className="badge badge--accent" style={{ marginLeft: 'auto' }}>{t.common.creator}</span>
                                    )}

                                    {/* Remove button: if I am creator (and target is not me) OR if target is me */}
                                    {(activeMembers.length > 1 && (
                                        (state.creatorRootPubkey === myPubkey && m.rootPubkey !== myPubkey) ||
                                        (m.rootPubkey === myPubkey && m.rootPubkey !== state.creatorRootPubkey)
                                    )) && (
                                            <button
                                                className="btn btn--ghost btn--sm"
                                                style={{ marginLeft: m.rootPubkey === state.creatorRootPubkey ? 'var(--space-2)' : 'auto', color: 'var(--danger)', fontSize: 'var(--font-size-xs)' }}
                                                onClick={() => handleRemoveMember(m.rootPubkey)}
                                            >
                                                {t.groupDetail.removeMember}
                                            </button>
                                        )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Balances */}
                <div className="glass-card glass-card--static" style={{ padding: 'var(--space-5)' }}>
                    <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.groupDetail.balancesTitle}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        {activeMembers.map((m) => {
                            const bal = balances.get(m.rootPubkey as PublicKey) ?? 0;
                            const cls = bal > 0 ? 'amount--positive' : bal < 0 ? 'amount--negative' : 'amount--zero';
                            return (
                                <div key={m.rootPubkey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: 'var(--font-size-sm)' }}>{m.displayName}</span>
                                    <span className={`amount ${cls}`} style={{ fontSize: 'var(--font-size-sm)' }}>{formatAmount(bal)}</span>
                                </div>
                            );
                        })}
                    </div>

                    {activeMembers.length > 1 && (
                        <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--glass-border)' }}>
                            <h4 style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)', textTransform: 'uppercase' }}>{t.groupDetail.settlementsTitle}</h4>
                            <Settlements members={activeMembers} balances={balances} onSettle={handleSettleUp} />
                        </div>
                    )}
                </div>
            </div>

            {/* Expense Feed */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                    <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                        {t.groupDetail.expensesTitle} ({expenses.length})
                    </h3>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Total: {getCurrency(entries)} {(totalGroupExpenses / 100).toFixed(2)}
                    </div>
                </div>
                {expenses.length === 0 ? (
                    <div className="glass-card glass-card--static" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
                        <p style={{ color: 'var(--text-tertiary)' }}>{t.groupDetail.noExpenses}</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        {[...expenses].reverse().map(({ entry: e, payload: p }, i) => {
                            const payer = state.members.get(p.paidByRootPubkey as PublicKey);
                            const isMyExpense = p.paidByRootPubkey === myPubkey;
                            return (
                                <div key={e.entryId} className={`glass-card glass-card--static stagger-${Math.min(i + 1, 5)} animate-fade-in`} style={{ padding: 'var(--space-4)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>{p.description}</div>
                                            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                                                {t.groupDetail.paidBy} {isMyExpense ? t.common.you : payer?.displayName ?? 'Unknown'}
                                                {' · '}
                                                {new Date(e.timestamp).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                            <Link className="btn btn--ghost btn--sm" to={`/group/${groupId}/expense?edit=${e.entryId}`}>Edit</Link>
                                            <div className="amount" style={{ fontSize: 'var(--font-size-lg)' }}>
                                                {p.currency} {(p.amountMinorUnits / 100).toFixed(2)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Danger Zone */}
            <div style={{ marginTop: 'var(--space-8)', paddingTop: 'var(--space-8)', borderTop: '1px solid var(--glass-border)' }}>
                <button
                    className="btn btn--danger btn--full"
                    onClick={handleDeleteGroup}
                >
                    {t.groupDetail.deleteGroup ?? 'Delete Group'}
                </button>
            </div>
        </div>
    );
}

function ProtocolV2GroupDetail({ state, onDelete }: { state: GroupStateV2; onDelete: () => Promise<void> }) {
    const { t } = useI18n();
    const {
        identity, createParticipantSlotV2, createOrReplaceInviteV2, createOrReplaceGenericInviteV2,
        voidExpenseV2, createSettlementV2, renameParticipantV2, disableParticipantV2, resetParticipantV2,
    } = useApp();
    const [participantName, setParticipantName] = useState('');
    const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
    const [copiedParticipantId, setCopiedParticipantId] = useState<string | null>(null);
    const [busyParticipantId, setBusyParticipantId] = useState<string | null>(null);
    const [genericInviteLink, setGenericInviteLink] = useState('');
    const [settling, setSettling] = useState<string | null>(null);
    const [settlementError, setSettlementError] = useState('');
    const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null);
    const [editedParticipantName, setEditedParticipantName] = useState('');
    const [participantError, setParticipantError] = useState('');
    const participants = Object.values(state.participants).filter(({ status }) => status !== 'disabled');
    const expenses = Object.values(state.expenses).filter((expense) => expense.status === 'effective');
    const currencies = Object.keys(state.balances).sort();
    const creator = state.participants[state.creatorParticipantId];
    const isCreator = creator?.claimedRootPublicKey === identity?.rootKeyPair.publicKey;
    const myParticipant = participants.find(
        ({ claimedRootPublicKey }) => claimedRootPublicKey === identity?.rootKeyPair.publicKey,
    );

    const addParticipant = async () => {
        if (!participantName.trim()) return;
        setBusyParticipantId('new');
        try {
            await createParticipantSlotV2(state.groupId as GroupId, participantName);
            setParticipantName('');
        } finally {
            setBusyParticipantId(null);
        }
    };

    const replaceInvite = async (participantId: string) => {
        setBusyParticipantId(participantId);
        try {
            const url = await createOrReplaceInviteV2(state.groupId as GroupId, participantId);
            setInviteLinks((current) => ({ ...current, [participantId]: url }));
            setCopiedParticipantId(null);
        } finally {
            setBusyParticipantId(null);
        }
    };

    const copyInvite = async (participantId: string) => {
        await navigator.clipboard.writeText(inviteLinks[participantId]);
        setCopiedParticipantId(participantId);
    };

    const replaceGenericInvite = async () => {
        setBusyParticipantId('generic');
        try {
            setGenericInviteLink(await createOrReplaceGenericInviteV2(state.groupId as GroupId));
            setCopiedParticipantId(null);
        } finally {
            setBusyParticipantId(null);
        }
    };

    const copyGenericInvite = async () => {
        await navigator.clipboard.writeText(genericInviteLink);
        setCopiedParticipantId('generic');
    };

    const settle = async (currency: string, from: string, to: string, amount: number) => {
        if (!window.confirm(t.groupDetail.confirmSettleUp)) return;
        const key = `${currency}:${from}:${to}`;
        setSettling(key);
        setSettlementError('');
        try {
            await createSettlementV2(state.groupId as GroupId, from, to, amount, currency);
        } catch (error) {
            setSettlementError(error instanceof Error ? error.message : 'Unable to record settlement');
        } finally {
            setSettling(null);
        }
    };

    const saveParticipantName = async (participantId: string) => {
        setBusyParticipantId(participantId);
        setParticipantError('');
        try {
            await renameParticipantV2(state.groupId as GroupId, participantId, editedParticipantName);
            setEditingParticipantId(null);
        } catch (error) {
            setParticipantError(error instanceof Error ? error.message : 'Unable to rename participant');
        } finally {
            setBusyParticipantId(null);
        }
    };

    const disableParticipant = async (participantId: string) => {
        if (!window.confirm(t.groupDetail.confirmDisableParticipant)) return;
        setBusyParticipantId(participantId);
        setParticipantError('');
        try {
            await disableParticipantV2(state.groupId as GroupId, participantId);
        } catch (error) {
            setParticipantError(error instanceof Error ? error.message : 'Unable to disable participant');
        } finally {
            setBusyParticipantId(null);
        }
    };

    const resetParticipant = async (participantId: string) => {
        if (!window.confirm(t.groupDetail.confirmResetParticipant)) return;
        setBusyParticipantId(participantId);
        setParticipantError('');
        try {
            await resetParticipantV2(state.groupId as GroupId, participantId);
        } catch (error) {
            setParticipantError(error instanceof Error ? error.message : 'Unable to reset participant');
        } finally {
            setBusyParticipantId(null);
        }
    };
    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <Link to="/dashboard" style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>{t.groupDetail.backToGroups}</Link>
                <h1 className="page-header__title">{state.groupName}</h1>
                <p className="page-header__subtitle">{participants.length} {participants.length === 1 ? t.common.member : t.common.members}</p>
                <Button asChild><Link to={`/group/${state.groupId}/expense`}>{t.groupDetail.addExpense}</Link></Button>
            </div>
            <div className="grid-responsive-cards" style={{ marginBottom: 'var(--space-6)' }}>
                <Card>
                    <CardHeader><CardTitle>{t.groupDetail.membersTitle}</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                    {participants.map((participant) => (
                        <div key={participant.participantId} className="rounded-lg border border-[#004502]/10 p-3">
                            {editingParticipantId === participant.participantId ? (
                                <div className="flex gap-2">
                                    <Input value={editedParticipantName} onChange={(event) => setEditedParticipantName(event.target.value)} />
                                    <Button size="icon" title={t.groupDetail.saveParticipantName} aria-label={t.groupDetail.saveParticipantName} disabled={!editedParticipantName.trim() || busyParticipantId !== null} onClick={() => void saveParticipantName(participant.participantId)}><Check className="size-4" /></Button>
                                </div>
                            ) : <div className="flex items-center justify-between gap-2"><strong className="min-w-0 truncate">{participant.displayName}</strong><span className="badge badge--accent shrink-0">{participant.status}</span></div>}
                            {isCreator && editingParticipantId !== participant.participantId && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                    <Button variant="ghost" size="icon" title={t.groupDetail.renameParticipant} aria-label={t.groupDetail.renameParticipant} onClick={() => {
                                        setEditingParticipantId(participant.participantId);
                                        setEditedParticipantName(participant.displayName);
                                    }}><Pencil className="size-4" /></Button>
                                    {participant.participantId !== state.creatorParticipantId && participant.status === 'claimed' && (
                                        <Button variant="secondary" size="icon" title={t.groupDetail.resetParticipant} aria-label={t.groupDetail.resetParticipant} disabled={busyParticipantId !== null} onClick={() => void resetParticipant(participant.participantId)}><RotateCcw className="size-4" /></Button>
                                    )}
                                    {participant.participantId !== state.creatorParticipantId && (
                                        <Button variant="destructive" size="icon" title={t.groupDetail.disableParticipant} aria-label={t.groupDetail.disableParticipant} disabled={busyParticipantId !== null} onClick={() => void disableParticipant(participant.participantId)}><UserMinus className="size-4" /></Button>
                                    )}
                                </div>
                            )}
                            {isCreator && participant.status === 'unclaimed' && (
                                <div className="mt-2 flex flex-col gap-2">
                                    <Button variant="secondary" size="sm" className="w-full sm:w-auto" disabled={busyParticipantId !== null} onClick={() => void replaceInvite(participant.participantId)}>
                                        <Link2 className="size-4" /><span className="hidden sm:inline">{inviteLinks[participant.participantId] ? t.groupDetail.replaceInviteForParticipant : t.groupDetail.createInviteForParticipant}</span><span className="sm:hidden">{t.groupDetail.invite}</span>
                                    </Button>
                                    {inviteLinks[participant.participantId] && (
                                        <div className="flex gap-2"><Input className="min-w-0" readOnly value={inviteLinks[participant.participantId]} aria-label={t.groupDetail.inviteLinkTitle} /><Button variant="ghost" size="icon" title={t.groupDetail.copyInvite} aria-label={t.groupDetail.copyInvite} onClick={() => void copyInvite(participant.participantId)}>{copiedParticipantId === participant.participantId ? <Check className="size-4" /> : <Copy className="size-4" />}</Button></div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                    {participantError && <p style={{ color: 'var(--danger)' }}>{participantError}</p>}
                    {isCreator && (
                        <div className="border-t border-[#004502]/10 pt-3">
                            <div className="flex gap-2">
                                <Input value={participantName} placeholder={t.groupDetail.participantNamePlaceholder} onChange={(event) => setParticipantName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addParticipant(); }} />
                                <Button className="shrink-0" disabled={!participantName.trim() || busyParticipantId !== null} onClick={() => void addParticipant()} title={t.groupDetail.addParticipant}>
                                    <UserPlus className="size-4" /><span className="hidden sm:inline">{t.groupDetail.addParticipant}</span>
                                </Button>
                            </div>
                            {participants.some(({ status }) => status === 'unclaimed') && (
                                <div className="mt-3 space-y-2">
                                    <p className="text-sm text-[#716969]">{t.groupDetail.genericInviteHelp}</p>
                                    <Button variant="secondary" size="sm" className="w-full sm:w-auto" disabled={busyParticipantId !== null} onClick={() => void replaceGenericInvite()}>
                                        <Link2 className="size-4" />
                                        {genericInviteLink ? t.groupDetail.replaceGenericInvite : t.groupDetail.createGenericInvite}
                                    </Button>
                                    {genericInviteLink && (
                                        <div className="flex gap-2"><Input className="min-w-0" readOnly value={genericInviteLink} aria-label={t.groupDetail.inviteLinkTitle} /><Button variant="ghost" size="icon" title={t.groupDetail.copyInvite} aria-label={t.groupDetail.copyInvite} onClick={() => void copyGenericInvite()}>{copiedParticipantId === 'generic' ? <Check className="size-4" /> : <Copy className="size-4" />}</Button></div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>{t.groupDetail.balancesTitle}</CardTitle></CardHeader>
                    <CardContent>
                    {currencies.length === 0 ? <p className="text-sm text-[#716969]">{t.groupDetail.allSettled}</p> : currencies.map((currency) => (
                        <div key={currency} className="mb-4 last:mb-0">
                            <strong className="text-sm">{currency}</strong>
                            <div className="mt-2 space-y-1">
                            {Object.entries(state.balances[currency] ?? {}).map(([participantId, amount]) => (
                                <div key={participantId} className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate text-[#716969]">{state.participants[participantId]?.displayName ?? participantId}</span><span className="shrink-0 font-medium">{currency} {(amount / 100).toFixed(2)}</span></div>
                            ))}
                            </div>
                            <div className="mt-3 space-y-2 border-t border-[#004502]/10 pt-3">
                                {computeSettlements(new Map(
                                    Object.entries(state.balances[currency] ?? {})
                                        .map(([participantId, amount]) => [participantId as PublicKey, amount]),
                                )).map((suggestion) => {
                                    const key = `${currency}:${suggestion.from}:${suggestion.to}`;
                                    const canRecord = myParticipant?.participantId === suggestion.from;
                                    return (
                                        <div key={key} className="rounded-lg bg-[#004502]/[0.03] p-2 text-sm">
                                            <div className="flex flex-wrap items-center gap-1"><span>{state.participants[suggestion.from]?.displayName}</span><ArrowRight className="size-3.5" /><span>{state.participants[suggestion.to]?.displayName}</span><strong className="ml-auto">{currency} {(suggestion.amount / 100).toFixed(2)}</strong></div>
                                            {canRecord ? (
                                                <Button variant="secondary" size="sm" className="mt-2 w-full" disabled={settling !== null} onClick={() => void settle(currency, suggestion.from, suggestion.to, suggestion.amount)}>
                                                    {settling === key ? t.groupDetail.settling : t.groupDetail.markAsPaid}
                                                </Button>
                                            ) : <div className="mt-1 text-xs text-gray-400">{t.groupDetail.payerMustSettle}</div>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    {settlementError && <p className="mt-3 text-sm text-red-600">{settlementError}</p>}
                    </CardContent>
                </Card>
            </div>
            <Card className="mb-6">
                <CardHeader><CardTitle>{t.groupDetail.expensesTitle}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                {expenses.length === 0 ? <p className="text-sm text-[#716969]">{t.groupDetail.noExpenses}</p> : expenses.map((expense) => (
                    <div key={expense.expenseId} className="flex flex-col gap-3 rounded-lg border border-[#004502]/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <strong className="block truncate">{String(expense.expense.description)}</strong>
                            <div className="text-sm text-[#716969]">
                                {String(expense.expense.currency)} {(Number(expense.expense.amountMinorUnits) / 100).toFixed(2)} · {t.groupDetail.paidBy} {state.participants[String(expense.expense.paidBy)]?.displayName}
                            </div>
                        </div>
                        <div className="flex shrink-0 gap-1 self-end sm:self-auto">
                            <Button asChild variant="ghost" size="icon"><Link title={t.groupDetail.editExpense} aria-label={t.groupDetail.editExpense} to={`/group/${state.groupId}/expense?edit=${expense.expenseId}`}><Pencil className="size-4" /></Link></Button>
                            <Button variant="destructive" size="icon" title={t.groupDetail.voidExpense} aria-label={t.groupDetail.voidExpense} onClick={() => void voidExpenseV2(state.groupId as GroupId, expense.expenseId, 'Expense removed')}><Trash2 className="size-4" /></Button>
                        </div>
                    </div>
                ))}
                </CardContent>
            </Card>
            <Button variant="destructive" className="w-full sm:w-auto" onClick={() => void onDelete()}><Trash2 className="size-4" />{t.groupDetail.deleteGroup}</Button>
        </div>
    );
}

function Settlements({ members, balances, onSettle }: { members: { rootPubkey: string; displayName: string }[]; balances: Map<PublicKey, number>; onSettle: (from: string, to: string, amount: number) => void }) {
    const { t } = useI18n();
    // Map names for display
    const nameMap = new Map(members.map(m => [m.rootPubkey, m.displayName]));
    // Use core computeSettlements
    const rawSettlements = computeSettlements(balances);

    if (rawSettlements.length === 0) {
        return <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{t.groupDetail.allSettled}</p>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {rawSettlements.map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                    <div>
                        <span style={{ color: 'var(--danger)' }}>{nameMap.get(s.from) ?? 'Unknown'}</span>
                        {' → '}
                        <span style={{ color: 'var(--success)' }}>{nameMap.get(s.to) ?? 'Unknown'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span className="amount">{formatAmount(s.amount)}</span>
                        <button
                            className="btn btn--secondary btn--sm"
                            style={{ padding: '2px 6px', fontSize: '10px' }}
                            onClick={() => onSettle(s.from, s.to, s.amount)}
                        >
                            {t.groupDetail.markAsPaid}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

function formatAmount(minorUnits: number): string {
    const abs = Math.abs(minorUnits);
    return `${minorUnits < 0 ? '-' : ''}€${(abs / 100).toFixed(2)}`;
}

function hashColor(pubkey: string): string {
    const hue = parseInt(pubkey.slice(0, 4), 16) % 360;
    return `hsl(${hue}, 60%, 40%)`;
}

function getCurrency(entries: LedgerEntry[]): string {
    for (const e of entries) {
        if (e.entryType === EntryType.ExpenseCreated) {
            return (e.payload as { currency: string }).currency;
        }
    }
    return 'EUR';
}
