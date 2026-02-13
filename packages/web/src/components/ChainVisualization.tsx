import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { EntryType, type LedgerEntry } from '@splitledger/core';

interface Props {
    entries: LedgerEntry[];
    memberNames: Map<string, string>;
}

const ENTRY_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
    [EntryType.Genesis]: { bg: 'rgba(255, 193, 7, 0.12)', border: '#ffc107', icon: '🌱' },
    [EntryType.ExpenseCreated]: { bg: 'rgba(0, 210, 190, 0.12)', border: '#00d2be', icon: '💰' },
    [EntryType.ExpenseCorrection]: { bg: 'rgba(0, 210, 190, 0.08)', border: '#00a89a', icon: '✏️' },
    [EntryType.MemberAdded]: { bg: 'rgba(99, 102, 241, 0.12)', border: '#6366f1', icon: '👤' },
    [EntryType.MemberRemoved]: { bg: 'rgba(239, 68, 68, 0.12)', border: '#ef4444', icon: '🚫' },
    [EntryType.DeviceAuthorized]: { bg: 'rgba(99, 102, 241, 0.08)', border: '#818cf8', icon: '📱' },
    [EntryType.DeviceRevoked]: { bg: 'rgba(239, 68, 68, 0.08)', border: '#f87171', icon: '🔒' },
    [EntryType.RootKeyRotation]: { bg: 'rgba(168, 85, 247, 0.12)', border: '#a855f7', icon: '🔑' },
};

function getEntryLabel(type: string, t: ReturnType<typeof useI18n>['t']): string {
    const map: Record<string, string> = {
        [EntryType.Genesis]: t.chain.genesis,
        [EntryType.ExpenseCreated]: t.chain.expense,
        [EntryType.ExpenseCorrection]: t.chain.expense,
        [EntryType.MemberAdded]: t.chain.memberAdded,
        [EntryType.MemberRemoved]: t.chain.memberRemoved,
        [EntryType.DeviceAuthorized]: t.chain.deviceAuthorized,
        [EntryType.DeviceRevoked]: t.chain.deviceRevoked,
        [EntryType.RootKeyRotation]: t.chain.rootKeyRotation,
    };
    return map[type] ?? type;
}

function getPayloadSummary(entry: LedgerEntry): string {
    const p = entry.payload as unknown as Record<string, unknown>;
    if (entry.entryType === EntryType.Genesis) {
        return (p.groupName as string) ?? '';
    }
    if (entry.entryType === EntryType.ExpenseCreated || entry.entryType === EntryType.ExpenseCorrection) {
        const desc = (p.description as string) ?? '';
        const amount = (p.amountMinorUnits as number) ?? 0;
        const currency = (p.currency as string) ?? 'EUR';
        return `${desc} — ${currency} ${(amount / 100).toFixed(2)}`;
    }
    if (entry.entryType === EntryType.MemberAdded) {
        return (p.memberDisplayName as string) ?? '';
    }
    if (entry.entryType === EntryType.MemberRemoved) {
        return (p.reason as string) ?? '';
    }
    return '';
}

export function ChainVisualization({ entries, memberNames }: Props) {
    const { t } = useI18n();

    const sortedEntries = useMemo(() => {
        return [...entries].sort((a, b) => a.lamportClock - b.lamportClock);
    }, [entries]);

    if (sortedEntries.length === 0) return null;

    const NODE_HEIGHT = 88;
    const NODE_GAP = 16;
    const CONNECTOR_HEIGHT = NODE_GAP;
    const totalHeight = sortedEntries.length * NODE_HEIGHT + (sortedEntries.length - 1) * CONNECTOR_HEIGHT + 40;

    return (
        <div className="glass-card glass-card--static animate-fade-in" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
            <h3 style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 'var(--space-4)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
            }}>
                {t.chain.title}
            </h3>

            <div style={{
                position: 'relative',
                overflowX: 'auto',
                overflowY: 'auto',
                maxHeight: '600px',
            }}>
                <svg
                    width="100%"
                    viewBox={`0 0 640 ${totalHeight}`}
                    style={{ minWidth: '500px' }}
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <defs>
                        <linearGradient id="chain-connector" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.6" />
                            <stop offset="100%" stopColor="var(--accent-secondary)" stopOpacity="0.6" />
                        </linearGradient>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="2" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {sortedEntries.map((entry, i) => {
                        const y = 20 + i * (NODE_HEIGHT + CONNECTOR_HEIGHT);
                        const colors = ENTRY_COLORS[entry.entryType] ?? ENTRY_COLORS[EntryType.Genesis];
                        const shortHash = entry.entryId.slice(0, 10) + '…';
                        const shortPrev = entry.previousHash ? entry.previousHash.slice(0, 10) + '…' : '—';
                        const signerName = memberNames.get(entry.creatorDevicePubkey) ?? entry.creatorDevicePubkey.slice(0, 8) + '…';
                        const summary = getPayloadSummary(entry);
                        const label = getEntryLabel(entry.entryType, t);

                        return (
                            <g key={entry.entryId} className="chain-node" style={{ animation: `fadeSlideIn 0.3s ease ${i * 0.05}s both` }}>
                                {/* Connector line to next */}
                                {i < sortedEntries.length - 1 && (
                                    <line
                                        x1="320" y1={y + NODE_HEIGHT}
                                        x2="320" y2={y + NODE_HEIGHT + CONNECTOR_HEIGHT}
                                        stroke="url(#chain-connector)"
                                        strokeWidth="2"
                                        strokeDasharray="6 3"
                                    />
                                )}

                                {/* Node background */}
                                <rect
                                    x="40" y={y}
                                    width="560" height={NODE_HEIGHT}
                                    rx="12" ry="12"
                                    fill={colors.bg}
                                    stroke={colors.border}
                                    strokeWidth="1"
                                    opacity="0.9"
                                />

                                {/* Left accent bar (clipped to rounded rect) */}
                                <clipPath id={`clip-${i}`}>
                                    <rect x="40" y={y} width="560" height={NODE_HEIGHT} rx="12" ry="12" />
                                </clipPath>
                                <rect
                                    x="40" y={y}
                                    width="5" height={NODE_HEIGHT}
                                    fill={colors.border}
                                    clipPath={`url(#clip-${i})`}
                                />

                                {/* Icon + type label */}
                                <text x="60" y={y + 24} fontSize="13" fill={colors.border} fontWeight="600" fontFamily="Inter, system-ui, sans-serif">
                                    {colors.icon} {label}
                                </text>

                                {/* Summary */}
                                {summary && (
                                    <text x="60" y={y + 44} fontSize="12" fill="var(--text-secondary)" fontFamily="Inter, system-ui, sans-serif">
                                        {summary.length > 60 ? summary.slice(0, 57) + '…' : summary}
                                    </text>
                                )}

                                {/* Hash info row */}
                                <text x="60" y={y + 66} fontSize="10" fill="var(--text-tertiary)" fontFamily="'JetBrains Mono', monospace">
                                    {t.chain.hash}: {shortHash}
                                </text>
                                <text x="260" y={y + 66} fontSize="10" fill="var(--text-tertiary)" fontFamily="'JetBrains Mono', monospace">
                                    {t.chain.previousHash}: {shortPrev}
                                </text>
                                <text x="460" y={y + 66} fontSize="10" fill="var(--text-tertiary)" fontFamily="'JetBrains Mono', monospace">
                                    {t.chain.clock}: {entry.lamportClock}
                                </text>

                                {/* Signer + timestamp */}
                                <text x="60" y={y + 82} fontSize="10" fill="var(--text-tertiary)" fontFamily="Inter, system-ui, sans-serif">
                                    {t.chain.signedBy}: {signerName}
                                </text>
                                <text x="460" y={y + 82} fontSize="10" fill="var(--text-tertiary)" fontFamily="Inter, system-ui, sans-serif" textAnchor="start">
                                    {new Date(entry.timestamp).toLocaleString()}
                                </text>

                                {/* Clock badge — fully inside the rect */}
                                <circle cx="575" cy={y + 22} r="12" fill={colors.border} opacity="0.2" />
                                <text x="575" y={y + 26} fontSize="9" fill={colors.border} fontWeight="700" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif">
                                    #{entry.lamportClock}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>

            <style>{`
                @keyframes fadeSlideIn {
                    from { opacity: 0; transform: translateY(8px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
