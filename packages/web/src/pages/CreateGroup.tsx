import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { type GroupId } from '@splitledger/core';

export function CreateGroup() {
    const { manager, refreshGroups, broadcastEntry } = useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);

    const handleCreate = async () => {
        if (!manager || !name.trim()) return;
        setCreating(true);
        try {
            const { groupId, genesisEntry } = await manager.createGroup(name.trim());
            await broadcastEntry(groupId as GroupId, genesisEntry);
            await refreshGroups();
            navigate(`/group/${groupId}`);
        } catch (err) {
            console.error('Failed to create group:', err);
            setCreating(false);
        }
    };

    return (
        <div style={{ maxWidth: '480px', margin: '0 auto' }}>
            <div className="page-header">
                <h1 className="page-header__title">{t.createGroup.title}</h1>
                <p className="page-header__subtitle">{t.createGroup.subtitle}</p>
            </div>

            <div className="glass-card glass-card--static animate-fade-in" style={{ padding: 'var(--space-6)' }}>
                <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
                    <label className="form-label">{t.createGroup.nameLabel}</label>
                    <input
                        className="form-input"
                        type="text"
                        placeholder={t.createGroup.namePlaceholder}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCreate()}
                        autoFocus
                    />
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn btn--ghost" onClick={() => navigate('/dashboard')}>{t.common.cancel}</button>
                    <button className="btn btn--primary btn--full" onClick={handleCreate} disabled={!name.trim() || creating}>
                        {creating ? t.createGroup.creating : t.createGroup.createButton}
                    </button>
                </div>
            </div>
        </div>
    );
}
