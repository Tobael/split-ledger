import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { ArrowRight, LogIn, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function Dashboard() {
    const { groups } = useApp();
    const { t } = useI18n();

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-[#004502]">{t.dashboard.title}</h1>
                    <p className="mt-1 text-sm text-[#716969]">{t.dashboard.subtitle}</p>
                </div>
                <div className="flex gap-2">
                    <Button asChild variant="secondary" className="flex-1 sm:flex-none"><Link to="/join"><LogIn className="size-4" />{t.dashboard.joinGroup}</Link></Button>
                    <Button asChild className="flex-1 sm:flex-none"><Link to="/create-group"><Plus className="size-4" />{t.dashboard.newGroup}</Link></Button>
                </div>
            </div>

            {groups.length === 0 ? (
                <Card className="animate-fade-in py-12 text-center">
                    <CardContent className="mx-auto flex max-w-md flex-col items-center gap-4">
                    <div className="flex size-12 items-center justify-center rounded-full bg-[#004502]/10"><Users className="size-6" /></div>
                    <div><h3 className="text-xl font-semibold">{t.dashboard.noGroupsTitle}</h3><p className="mt-1 text-sm text-[#716969]">{t.dashboard.noGroupsText}</p></div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
                        <Button asChild variant="secondary"><Link to="/join"><LogIn className="size-4" />{t.dashboard.joinGroup}</Link></Button>
                        <Button asChild><Link to="/create-group"><Plus className="size-4" />{t.dashboard.createGroup}</Link></Button>
                    </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {groups.map((g, i) => (
                        <Link
                            key={g.groupId}
                            to={`/group/${g.groupId}`}
                            className={`group rounded-xl border border-[#004502]/10 bg-white p-5 text-inherit shadow-sm transition hover:-translate-y-0.5 hover:border-[#004502]/25 hover:shadow-md stagger-${Math.min(i + 1, 5)} animate-fade-in`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h3 className="truncate text-lg font-semibold">
                                        {g.name}
                                    </h3>
                                    <span className="mt-1 inline-flex rounded-full bg-[#004502]/10 px-2 py-0.5 text-xs font-medium">
                                        {g.memberCount} {g.memberCount === 1 ? t.common.member : t.common.members}
                                    </span>
                                </div>
                                <BalanceDisplay amount={g.myBalance} currency={g.currency} />
                            </div>
                            <div className="mt-4 flex items-center gap-1 text-xs text-[#716969] group-hover:text-[#004502]">
                                {t.dashboard.viewDetails}<ArrowRight className="size-3.5" />
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}

function BalanceDisplay({ amount, currency }: { amount: number; currency: string }) {
    const { t } = useI18n();
    const formatted = formatAmount(amount, currency);
    const cls = amount > 0 ? 'text-green-700' : amount < 0 ? 'text-red-700' : 'text-[#716969]';
    const label = amount > 0 ? t.common.youAreOwed : amount < 0 ? t.common.youOwe : t.common.settledUp;

    return (
        <div className="text-right">
            <div className={`text-xl font-semibold ${cls}`}>{formatted}</div>
            <div className="text-xs text-[#716969]">{label}</div>
        </div>
    );
}

function formatAmount(minorUnits: number, currency: string): string {
    const abs = Math.abs(minorUnits);
    const major = (abs / 100).toFixed(2);
    const sign = minorUnits < 0 ? '-' : minorUnits > 0 ? '+' : '';
    return `${sign}${currency} ${major}`;
}
