import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';


export function CreateGroup() {
    const { createGroup } = useApp(); // Use createGroup which handles updates optimistically
    const { t } = useI18n();
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [currency, setCurrency] = useState('EUR');
    const [isCreating, setIsCreating] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setIsCreating(true);
        try {
            // Optimistic createGroup returns the ID immediately after local creation
            const groupId = await createGroup(name.trim(), currency);
            navigate(`/group/${groupId}`);
        } catch (err) {
            console.error('Failed to create group:', err);
            setIsCreating(false);
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
                        onKeyDown={e => e.key === 'Enter' && handleSubmit(e)}
                        autoFocus
                    />
                </div>

                <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
                    <label className="form-label">{t.createGroup.currencyLabel}</label>
                    <select
                        className="form-input"
                        value={currency}
                        onChange={e => setCurrency(e.target.value)}
                    >
                        <option value="EUR">EUR (€)</option>
                        <option value="USD">USD ($)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="CHF">CHF</option>
                        <option value="JPY">JPY (¥)</option>
                    </select>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn btn--ghost" onClick={() => navigate('/dashboard')}>{t.common.cancel}</button>
                    <button className="btn btn--primary btn--full" onClick={handleSubmit} disabled={!name.trim() || isCreating}>
                        {isCreating ? t.createGroup.creating : t.createGroup.createButton}
                    </button>
                </div>
            </div>
        </div>
    );
}
