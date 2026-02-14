import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { ChainVisualization } from '../components/ChainVisualization';
import {
    type GroupState,
    type LedgerEntry,
    type GroupId,
    type PublicKey,
    EntryType,
    computeBalances,
    computeSettlements,
    buildEntry,
    orderEntries,
    validateFullChain,
} from '@splitledger/core';

interface ExpensePayload {
    description: string;
    amountMinorUnits: number;
    currency: string;
    paidByRootPubkey: string;
    splits: Record<string, number>;
}

export function GroupDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const { manager, getGroupState, getGroupEntries, identity, broadcastEntry, refreshGroups, storage, deleteGroup } = useApp();
    const { t } = useI18n();
    const groupId = id as GroupId;

    const [state, setState] = useState<GroupState | null>(null);
    const [entries, setEntries] = useState<LedgerEntry[]>([]);
    const [inviteLink, setInviteLink] = useState('');
    const [showInvite, setShowInvite] = useState(false);
    const [copied, setCopied] = useState(false);
    const [showChain, setShowChain] = useState(false);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        if (!manager) return;
        try {
            const s = await getGroupState(groupId);
            const e = await getGroupEntries(groupId);
            setState(s);
            setEntries(e);
        } finally {
            setLoading(false);
        }
    }, [groupId, getGroupState, getGroupEntries, manager]);

    useEffect(() => {
        if (manager) {
            refresh();
        }
    }, [manager, refresh]);

    const handleCreateInvite = () => {
        if (!manager) return;
        const token = manager.createInviteLink(groupId);
        const link = `${window.location.origin}/join?token=${token}`;
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

    if (!state) {
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
    const expenses = entries.filter(e => e.entryType === EntryType.ExpenseCreated);
    const balances = computeBalances(entries);
    const myPubkey = identity?.rootKeyPair.publicKey;

    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-8)' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-1)' }}>
                        <Link to="/dashboard" style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>{t.groupDetail.backToGroups}</Link>
                    </div>
                    <h1 className="page-header__title">{state.groupName}</h1>
                    <p className="page-header__subtitle">{activeMembers.length} {activeMembers.length === 1 ? t.common.member : t.common.members}</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn btn--ghost" onClick={() => setShowChain(v => !v)}>{showChain ? t.groupDetail.hideChain : t.groupDetail.viewChain}</button>
                    <Link to={`/group/${groupId}/recovery`} className="btn btn--secondary">🛡️</Link>
                    <button className="btn btn--secondary" onClick={handleCreateInvite}>{t.groupDetail.invite}</button>
                    <Link to={`/group/${groupId}/expense`} className="btn btn--primary">{t.groupDetail.addExpense}</Link>
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
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
                <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t.groupDetail.expensesTitle} ({expenses.length})
                </h3>
                {expenses.length === 0 ? (
                    <div className="glass-card glass-card--static" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
                        <p style={{ color: 'var(--text-tertiary)' }}>{t.groupDetail.noExpenses}</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        {[...expenses].reverse().map((e, i) => {
                            const p = e.payload as ExpensePayload;
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
                                        <div className="amount" style={{ fontSize: 'var(--font-size-lg)' }}>
                                            {p.currency} {(p.amountMinorUnits / 100).toFixed(2)}
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


