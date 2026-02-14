import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';

export function JoinGroup() {
    const { manager, refreshGroups, syncGroupFromRelay, broadcastEntry } = useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const tokenParam = searchParams.get('token');

    // If token is in URL, constructing the full link for the input field or just using the token
    // The manager.joinGroup expects the token string, but we show the link in the UI usually.
    // However, the `syncGroupFromRelay` and `joinGroup` might expect just the token or handle both.
    // Let's pre-fill the input with the full link if possible, or just the token?
    // The previous implementation used `inviteLink.trim()` which implied the user pasted something.
    // If we put the full URL in the input, `parseInviteLink` in core/web/context needs to handle it.
    // Let's assume the user wants to see the token or link.
    // We will construct the full link if it's missing.

    const [inviteLink, setInviteLink] = useState(tokenParam ? `${window.location.origin}/join?token=${tokenParam}` : '');
    const [displayName, setDisplayName] = useState('');
    const [joining, setJoining] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');

    const handleJoin = async () => {
        if (!manager || !inviteLink.trim() || !displayName.trim()) return;
        setJoining(true);
        setError('');
        try {
            // Step 1: Sync group entries from relay
            setStatus(t.joinGroup.syncing);
            await syncGroupFromRelay(inviteLink.trim());

            // Step 2: Join the group
            setStatus(t.joinGroup.joining);
            const { groupId, memberAddedEntry } = await manager.joinGroup(inviteLink.trim(), displayName.trim());

            // Step 3: Broadcast MemberAdded entry to relay so others see us
            await broadcastEntry(groupId, memberAddedEntry);
            await refreshGroups();
            navigate(`/group/${groupId}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to join group');
            setJoining(false);
            setStatus('');
        }
    };

    return (
        <div style={{ maxWidth: '480px', margin: '0 auto' }}>
            <div className="page-header">
                <h1 className="page-header__title">{t.joinGroup.title}</h1>
                <p className="page-header__subtitle">{t.joinGroup.subtitle}</p>
            </div>

            <div className="glass-card glass-card--static animate-fade-in" style={{ padding: 'var(--space-6)' }}>
                <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                    <label className="form-label">{t.joinGroup.inviteLabel}</label>
                    <input
                        className="form-input"
                        type="text"
                        placeholder={t.joinGroup.invitePlaceholder}
                        value={inviteLink}
                        onChange={e => { setInviteLink(e.target.value); setError(''); }}
                        autoFocus
                    />
                </div>
                <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
                    <label className="form-label">{t.joinGroup.nameLabel}</label>
                    <input
                        className="form-input"
                        type="text"
                        placeholder={t.joinGroup.namePlaceholder}
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleJoin()}
                    />
                </div>

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
                    <button className="btn btn--ghost" onClick={() => navigate('/dashboard')}>{t.common.cancel}</button>
                    <button
                        className="btn btn--primary btn--full"
                        onClick={handleJoin}
                        disabled={!inviteLink.trim() || !displayName.trim() || joining}
                    >
                        {joining ? (status || t.joinGroup.joining) : t.joinGroup.joinButton}
                    </button>
                </div>
            </div>
        </div>
    );
}
