import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import {
    type GroupId,
    type GroupStateV2,
} from '@splitledger/core';
import { equalParticipantSplits } from '../utils/expense-splits';
import { ArrowLeft, Check, CircleDollarSign, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AddExpense() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const editId = searchParams.get('edit');

    const {
        getGroupStateV2, identity, createExpenseV2, correctExpenseV2,
    } = useApp();
    const { t } = useI18n();
    const groupId = id as GroupId;

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
            const state = await getGroupStateV2(groupId);
            if (!state) return;
            setStateV2(state);
            if (editId) {
                const projected = state.expenses[editId];
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
                const mine = Object.values(state.participants).find(
                    ({ claimedRootPublicKey }) => claimedRootPublicKey === identity.rootKeyPair.publicKey,
                );
                if (mine) setPaidBy(mine.participantId);
            }
        })();
    }, [groupId, getGroupStateV2, identity, editId]);

    if (!stateV2 || !identity) {
        return <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>{t.common.loading}</div>;
    }

    const activeMembers = Object.values(stateV2.participants)
        .filter(({ status }) => status !== 'disabled')
        .map((participant) => ({ id: participant.participantId, displayName: participant.displayName, isMe: participant.claimedRootPublicKey === identity.rootKeyPair.publicKey }));

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
        if (!description.trim() || !amount || !paidBy) return;
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

            const expense = {
                description: description.trim(),
                amountMinorUnits: amountMinor,
                currency: 'EUR',
                paidBy,
                splits,
            };
            if (editId) await correctExpenseV2(groupId, editId, expense, t.addExpense.correctionReason);
            else await createExpenseV2(groupId, expense);
            navigate(`/group/${groupId}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add expense');
            setSubmitting(false);
        }
    };

    return (
        <div className="mx-auto max-w-xl">
            <Link to={`/group/${groupId}`} className="mb-3 inline-flex items-center gap-1 text-sm text-[#716969] hover:text-[#004502]"><ArrowLeft className="size-4" />{t.addExpense.backTo} {stateV2.groupName}</Link>
            <Card className="animate-fade-in">
                <CardHeader>
                    <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-[#004502]/10"><CircleDollarSign className="size-5" /></div>
                    <CardTitle className="text-2xl normal-case tracking-normal text-[#004502]">{editId ? t.groupDetail.editExpense : t.addExpense.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                <div>
                    <Label htmlFor="expense-description">{t.addExpense.descriptionLabel}</Label>
                    <Input id="expense-description" type="text" placeholder={t.addExpense.descriptionPlaceholder} value={description} onChange={e => setDescription(e.target.value)} autoFocus />
                </div>

                <div>
                    <Label htmlFor="expense-amount">{t.addExpense.amountLabel}</Label>
                    <div className="relative"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[#716969]">€</span><Input id="expense-amount" className="pl-7 text-lg font-semibold tabular-nums" inputMode="decimal" type="number" step="0.01" min="0" placeholder="0.00" value={amount} onChange={e => {
                        setAmount(e.target.value);
                        if (splitMode === 'custom') prefillCustomSplits(excludedParticipants, e.target.value);
                    }} /></div>
                </div>

                <div>
                    <Label htmlFor="paid-by">{t.addExpense.paidByLabel}</Label>
                    <select id="paid-by" className="h-10 w-full rounded-lg border border-[#004502]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#004502]/30" value={paidBy} onChange={e => setPaidBy(e.target.value)}>
                        {activeMembers.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.displayName}{m.isMe ? ` (${t.common.you})` : ''}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <Label>{t.addExpense.splitLabel}</Label>
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#004502]/5 p-1">
                        <Button variant={splitMode === 'equal' ? 'default' : 'ghost'} onClick={() => setSplitMode('equal')}>{t.addExpense.equal}</Button>
                        <Button variant={splitMode === 'custom' ? 'default' : 'ghost'} onClick={chooseCustomMode}>{t.addExpense.custom}</Button>
                    </div>
                </div>

                {splitMode === 'custom' && (
                    <div className="space-y-2">
                        <p className="text-sm text-[#716969]">{t.addExpense.customSplitHelp}</p>
                        {activeMembers.map(m => (
                            <div key={m.id} className={`grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 rounded-lg border p-2 ${excludedParticipants.has(m.id) ? 'border-gray-200 bg-gray-50 opacity-65' : 'border-[#004502]/10 bg-white'}`}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="min-w-0 justify-start px-2"
                                    onClick={() => toggleParticipantEligibility(m.id)}
                                    aria-pressed={!excludedParticipants.has(m.id)}
                                >
                                    {excludedParticipants.has(m.id) ? <X className="size-4 shrink-0 text-red-600" /> : <Check className="size-4 shrink-0 text-emerald-600" />}<span className="truncate">{m.displayName}</span>
                                </Button>
                                <Input className="text-right tabular-nums" inputMode="decimal" type="number" step="0.01" min="0" placeholder="0.00"
                                    value={customSplits[m.id] || ''}
                                    onChange={e => setCustomSplits(prev => ({ ...prev, [m.id]: e.target.value }))}
                                    disabled={excludedParticipants.has(m.id)} />
                            </div>
                        ))}
                    </div>
                )}

                {splitMode === 'equal' && amount && parseFloat(amount) > 0 && (
                    <Alert className="rounded-lg border-[#004502]/10 bg-[#004502]/5 text-[#004502]">
                        {t.addExpense.splitEqually} €{(parseFloat(amount) / activeMembers.length).toFixed(2)} {t.addExpense.perPerson}
                    </Alert>
                )}

                {error && (
                    <Alert className="rounded-lg border-red-200 bg-red-50 text-left text-red-700">{error}</Alert>
                )}

                <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => navigate(`/group/${groupId}`)}>{t.common.cancel}</Button>
                    <Button className="flex-1" onClick={handleSubmit} disabled={!description.trim() || !amount || submitting}>
                        {submitting
                            ? (editId ? t.addExpense.saving : t.addExpense.adding)
                            : (editId ? t.addExpense.saveButton : t.addExpense.addButton)}
                    </Button>
                </div>
                </CardContent>
            </Card>
        </div>
    );
}
