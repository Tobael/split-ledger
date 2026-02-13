import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';

export function Dashboard() {
    const { groups } = useApp();
    const { t } = useI18n();

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 className="page-header__title">{t.dashboard.title}</h1>
                    <p className="page-header__subtitle">{t.dashboard.subtitle}</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <Link to="/join" className="btn btn--secondary">{t.dashboard.joinGroup}</Link>
                    <Link to="/create-group" className="btn btn--primary">{t.dashboard.newGroup}</Link>
                </div>
            </div>

            {groups.length === 0 ? (
                <div className="empty-state glass-card glass-card--static animate-fade-in">
                    <div className="empty-state__icon">👥</div>
                    <h3 className="empty-state__title">{t.dashboard.noGroupsTitle}</h3>
                    <p className="empty-state__text">{t.dashboard.noGroupsText}</p>
                    <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                        <Link to="/join" className="btn btn--secondary">{t.dashboard.joinGroup}</Link>
                        <Link to="/create-group" className="btn btn--primary">{t.dashboard.createGroup}</Link>
                    </div>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
                    {groups.map((g, i) => (
                        <Link
                            key={g.groupId}
                            to={`/group/${g.groupId}`}
                            className={`glass-card stagger-${Math.min(i + 1, 5)} animate-fade-in`}
                            style={{ padding: 'var(--space-5)', display: 'block', color: 'inherit' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                                <div>
                                    <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                                        {g.name}
                                    </h3>
                                    <span className="badge badge--accent">
                                        {g.memberCount} {g.memberCount === 1 ? t.common.member : t.common.members}
                                    </span>
                                </div>
                                <BalanceDisplay amount={g.myBalance} currency={g.currency} />
                            </div>
                            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                                {t.dashboard.viewDetails}
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
    const cls = amount > 0 ? 'amount--positive' : amount < 0 ? 'amount--negative' : 'amount--zero';
    const label = amount > 0 ? t.common.youAreOwed : amount < 0 ? t.common.youOwe : t.common.settledUp;

    return (
        <div style={{ textAlign: 'right' }}>
            <div className={`amount ${cls}`} style={{ fontSize: 'var(--font-size-xl)' }}>{formatted}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
        </div>
    );
}

function formatAmount(minorUnits: number, currency: string): string {
    const abs = Math.abs(minorUnits);
    const major = (abs / 100).toFixed(2);
    const sign = minorUnits < 0 ? '-' : minorUnits > 0 ? '+' : '';
    return `${sign}${currency} ${major}`;
}
