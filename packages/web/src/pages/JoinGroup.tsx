import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { GroupStateV2, InvitePayloadV2 } from '@splitledger/core';

import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { browserLinkReceiver } from '../platform/BrowserLinkReceiver';
import { inviteTokenFromUrl } from '../platform/LinkReceiver';
import { ArrowLeft, LogIn } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
        <div className="mx-auto max-w-lg">
            <Card className="animate-fade-in">
                <CardHeader>
                    <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-[#004502]/10"><LogIn className="size-5" /></div>
                    <CardTitle className="text-2xl normal-case tracking-normal text-[#004502]">{t.joinGroup.title}</CardTitle>
                    <CardDescription>{t.joinGroup.subtitle}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                <div>
                    <Label>{t.joinGroup.inviteLabel}</Label>
                    <Input
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
                    <div>
                        <Label>{t.joinGroup.invitedAs}</Label>
                        <div className="rounded-lg bg-[#004502]/5 px-3 py-2 font-medium">{preview.state.participants[preview.invite.participantId]?.displayName}</div>
                    </div>
                )}

                {preview?.invite.scope === 'any-unclaimed-slot' && (
                    <div>
                        <Label htmlFor="participant-choice">{t.joinGroup.chooseParticipant}</Label>
                        <select id="participant-choice" className="h-10 w-full rounded-lg border border-[#004502]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#004502]/30" value={selectedParticipantId} onChange={(event) => setSelectedParticipantId(event.target.value)}>
                            <option value="">{t.joinGroup.chooseParticipantPlaceholder}</option>
                            {Object.values(preview.state.participants)
                                .filter(({ status }) => status === 'unclaimed')
                                .map((participant) => <option key={participant.participantId} value={participant.participantId}>{participant.displayName}</option>)}
                        </select>
                    </div>
                )}

                {error && <Alert className="rounded-lg border border-red-200 bg-red-50 text-left text-red-700">{error}</Alert>}

                <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => navigate('/dashboard')}><ArrowLeft className="size-4" />{t.common.cancel}</Button>
                    <Button
                        className="flex-1"
                        onClick={() => void loadOrClaim()}
                        disabled={!inviteLink.trim() || joining || Boolean(preview?.invite.scope === 'any-unclaimed-slot' && !selectedParticipantId)}
                    >
                        {joining ? (status || t.joinGroup.joining) : preview ? t.joinGroup.joinButton : t.joinGroup.loadInvite}
                    </Button>
                </div>
                </CardContent>
            </Card>
        </div>
    );
}
