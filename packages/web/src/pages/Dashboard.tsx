import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';

export function Dashboard() {
    const { groups, importIdentityFromJson } = useApp();
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
                        <button
                            className="btn btn--secondary"
                            onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = '.json';
                                input.onchange = (e) => {
                                    const file = (e.target as HTMLInputElement).files?.[0];
                                    if (file) {
                                        const reader = new FileReader();
                                        reader.onload = async (re) => {
                                            const content = re.target?.result as string;
                                            const pwd = prompt(t.settings?.passwordPrompt ?? "Enter password to decrypt:");
                                            if (pwd) {
                                                try {
                                                    const { decryptIdentity } = await import('../utils/identity-export');
                                                    const decryptedJson = await decryptIdentity(content, pwd);
                                                    const imported = JSON.parse(decryptedJson);

                                                    if (imported && imported.rootKeyPair) {
                                                        importIdentityFromJson(decryptedJson);
                                                        // Page will likely reload or refresh AppContext state implicitly
                                                    } else {
                                                        throw new Error("Invalid identity file structure");
                                                    }
                                                } catch (err) {
                                                    alert(t.settings?.importError ?? "Invalid file or password");
                                                }
                                            }
                                        };
                                        reader.readAsText(file);
                                    }
                                };
                                input.click();
                            }}
                            title={t.settings?.importButton ?? "Import Identity from JSON"}
                        >
                            📁 {t.settings?.importButton ?? "Import"}
                        </button>
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
