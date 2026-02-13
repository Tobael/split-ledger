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
    const { manager, getGroupState, getGroupEntries, identity } = useApp();
    const { t } = useI18n();
    const groupId = id as GroupId;

    const [state, setState] = useState<GroupState | null>(null);
    const [entries, setEntries] = useState<LedgerEntry[]>([]);
    const [inviteLink, setInviteLink] = useState('');
    const [showInvite, setShowInvite] = useState(false);
    const [copied, setCopied] = useState(false);
    const [showChain, setShowChain] = useState(false);

    const refresh = useCallback(async () => {
        const s = await getGroupState(groupId);
        const e = await getGroupEntries(groupId);
        setState(s);
        setEntries(e);
    }, [groupId, getGroupState, getGroupEntries]);

    useEffect(() => { refresh(); }, [refresh]);

    const handleCreateInvite = () => {
        if (!manager) return;
        const link = manager.createInviteLink(groupId);
        setInviteLink(link);
        setShowInvite(true);
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(inviteLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!state) {
        return <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>{t.common.loading}</div>;
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
                            <Settlements members={activeMembers} balances={balances} />
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
        </div>
    );
}

function Settlements({ members, balances }: { members: { rootPubkey: string; displayName: string }[]; balances: Map<PublicKey, number> }) {
    const { t } = useI18n();
    const settlements = computeSettlements(members, balances);
    if (settlements.length === 0) {
        return <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{t.groupDetail.allSettled}</p>;
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {settlements.map((s, i) => (
                <div key={i} style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--danger)' }}>{s.from}</span>
                    {' → '}
                    <span style={{ color: 'var(--success)' }}>{s.to}</span>
                    {' · '}
                    <span className="amount">{formatAmount(s.amount)}</span>
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

interface Settlement { from: string; to: string; amount: number; }

function computeSettlements(
    members: { rootPubkey: string; displayName: string }[],
    balances: Map<PublicKey, number>,
): Settlement[] {
    const nameMap = new Map(members.map(m => [m.rootPubkey, m.displayName]));
    const debtors: { key: string; amount: number }[] = [];
    const creditors: { key: string; amount: number }[] = [];

    for (const m of members) {
        const bal = balances.get(m.rootPubkey as PublicKey) ?? 0;
        if (bal < 0) debtors.push({ key: m.rootPubkey, amount: -bal });
        else if (bal > 0) creditors.push({ key: m.rootPubkey, amount: bal });
    }

    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const settlements: Settlement[] = [];
    let di = 0, ci = 0;
    while (di < debtors.length && ci < creditors.length) {
        const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
        if (transfer > 0) {
            settlements.push({
                from: nameMap.get(debtors[di].key) ?? 'Unknown',
                to: nameMap.get(creditors[ci].key) ?? 'Unknown',
                amount: transfer,
            });
        }
        debtors[di].amount -= transfer;
        creditors[ci].amount -= transfer;
        if (debtors[di].amount === 0) di++;
        if (creditors[ci].amount === 0) ci++;
    }

    return settlements;
}
