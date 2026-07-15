import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { GroupStateV2, InvitePayloadV2 } from '@splitledger/core';

import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { browserLinkReceiver } from '../platform/BrowserLinkReceiver';
import { inviteTokenFromUrl } from '../platform/LinkReceiver';

export function JoinGroup() {
    const { prepareInviteV2, claimInviteV2 } = useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const { token: pathToken } = useParams<{ token: string }>();
    const [searchParams] = useSearchParams();
    const [inviteLink, setInviteLink] = useState(pathToken ?? searchParams.get('token') ?? '');
    const [preview, setPreview] = useState<{ link: string; invite: InvitePayloadV2; state: GroupStateV2 } | null>(null);
    const [selectedParticipantId, setSelectedParticipantId] = useState('');
    const [joining, setJoining] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        const receive = (url: string) => {
            const token = inviteTokenFromUrl(url);
            if (token) {
                setInviteLink(token);
                setPreview(null);
                setSelectedParticipantId('');
            }
        };
        void browserLinkReceiver.getInitialUrl().then((url) => {
            if (url) receive(url);
        });
        return browserLinkReceiver.subscribe(receive);
    }, []);

    const loadOrClaim = async () => {
        const link = inviteLink.trim();
        if (!link) return;
        setJoining(true);
        setError('');
        try {
            if (!preview || preview.link !== link) {
                setStatus(t.joinGroup.syncing);
                const prepared = await prepareInviteV2(link);
                if (!prepared.state) {
                    setError(t.joinGroup.waitingForMember);
                    return;
                }
                setPreview({ link, invite: prepared.invite, state: prepared.state });
                setSelectedParticipantId(prepared.invite.participantId ?? '');
                return;
            }
            if (preview.invite.scope === 'any-unclaimed-slot' && !selectedParticipantId) return;
            setStatus(t.joinGroup.joining);
            const groupId = await claimInviteV2(
                preview.link,
                preview.invite.scope === 'any-unclaimed-slot' ? selectedParticipantId : undefined,
            );
            navigate(`/group/${groupId}`);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Failed to join group');
        } finally {
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
                        onChange={(event) => {
                            setInviteLink(event.target.value);
                            setPreview(null);
                            setSelectedParticipantId('');
                            setError('');
                        }}
                        autoFocus
                    />
                </div>

                {preview?.invite.scope === 'targeted' && preview.invite.participantId && (
                    <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
                        <label className="form-label">{t.joinGroup.invitedAs}</label>
                        <div>{preview.state.participants[preview.invite.participantId]?.displayName}</div>
                    </div>
                )}

                {preview?.invite.scope === 'any-unclaimed-slot' && (
                    <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
                        <label className="form-label" htmlFor="participant-choice">{t.joinGroup.chooseParticipant}</label>
                        <select id="participant-choice" className="form-input" value={selectedParticipantId} onChange={(event) => setSelectedParticipantId(event.target.value)}>
                            <option value="">{t.joinGroup.chooseParticipantPlaceholder}</option>
                            {Object.values(preview.state.participants)
                                .filter(({ status }) => status === 'unclaimed')
                                .map((participant) => <option key={participant.participantId} value={participant.participantId}>{participant.displayName}</option>)}
                        </select>
                    </div>
                )}

                {error && <div role="alert" style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--danger-dim)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-4)' }}>{error}</div>}

                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn btn--ghost" onClick={() => navigate('/dashboard')}>{t.common.cancel}</button>
                    <button
                        className="btn btn--primary btn--full"
                        onClick={() => void loadOrClaim()}
                        disabled={!inviteLink.trim() || joining || Boolean(preview?.invite.scope === 'any-unclaimed-slot' && !selectedParticipantId)}
                    >
                        {joining ? (status || t.joinGroup.joining) : preview ? t.joinGroup.joinButton : t.joinGroup.loadInvite}
                    </button>
                </div>
            </div>
        </div>
    );
}
