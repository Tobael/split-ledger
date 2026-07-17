import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import {
    type GroupId,
    type GroupStateV2,
    type PublicKey,
    computeSettlements,
} from '@splitledger/core';
import { ArrowRight, Check, Copy, Link2, Pencil, RotateCcw, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function GroupDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { getGroupStateV2, deleteGroup, lastUpdate, groupsWaitingForHistory } = useApp();
    const { t } = useI18n();
    const groupId = id as GroupId;
    const [state, setState] = useState<GroupStateV2 | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            setState(await getGroupStateV2(groupId));
        } finally {
            setLoading(false);
        }
    }, [getGroupStateV2, groupId]);

    useEffect(() => {
        void refresh();
    }, [refresh, lastUpdate]);

    const handleDeleteGroup = async () => {
        if (!confirm(t.groupDetail.confirmDelete)) return;
        try {
            await deleteGroup(groupId);
            navigate('/dashboard');
        } catch (error) {
            console.error('Failed to delete group', error);
        }
    };

    if (loading) {
        return <div className="p-8 text-[#716969]">{t.common.loading}</div>;
    }

    if (!state) {
        const waitingForHistory = groupsWaitingForHistory.has(groupId);
        return (
            <div className="empty-state animate-fade-in" role="status">
                <div className="empty-state__icon">{waitingForHistory ? '⏳' : '🚫'}</div>
                <h2 className="empty-state__title">
                    {waitingForHistory ? t.groupDetail.waitingForMemberTitle : t.groupDetail.accessDeniedTitle}
                </h2>
                <p className="empty-state__text">
                    {waitingForHistory ? t.groupDetail.waitingForMemberText : t.groupDetail.accessDeniedText}
                </p>
                <Button asChild variant="secondary"><Link to="/dashboard">{t.groupDetail.backToGroups}</Link></Button>
            </div>
        );
    }

    return <ProtocolV2GroupDetail state={state} onDelete={handleDeleteGroup} />;
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
                            <Button variant="destructive" size="icon" title={t.groupDetail.voidExpense} aria-label={t.groupDetail.voidExpense} onClick={() => void voidExpenseV2(state.groupId as GroupId, expense.expenseId, t.groupDetail.voidExpenseReason)}><Trash2 className="size-4" /></Button>
                        </div>
                    </div>
                ))}
                </CardContent>
            </Card>
            <Button variant="destructive" className="w-full sm:w-auto" onClick={() => void onDelete()}><Trash2 className="size-4" />{t.groupDetail.deleteGroup}</Button>
        </div>
    );
}
