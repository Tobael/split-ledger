import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';

export function JoinGroup() {
    const { manager, refreshGroups } = useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const [inviteLink, setInviteLink] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [joining, setJoining] = useState(false);
    const [error, setError] = useState('');

    const handleJoin = async () => {
        if (!manager || !inviteLink.trim() || !displayName.trim()) return;
        setJoining(true);
        setError('');
        try {
            const { groupId } = await manager.joinGroup(inviteLink.trim(), displayName.trim());
            await refreshGroups();
            navigate(`/group/${groupId}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to join group');
            setJoining(false);
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
                        {joining ? t.joinGroup.joining : t.joinGroup.joinButton}
                    </button>
                </div>
            </div>
        </div>
    );
}
