import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { ArrowLeft, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';


export function CreateGroup() {
    const { createGroup } = useApp(); // Use createGroup which handles updates optimistically
    const { t } = useI18n();
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setIsCreating(true);
        try {
            // Optimistic createGroup returns the ID immediately after local creation
            const groupId = await createGroup(name.trim(), 'EUR');
            navigate(`/group/${groupId}`);
        } catch (err) {
            console.error('Failed to create group:', err);
            setIsCreating(false);
        }
    };

    return (
        <div className="mx-auto max-w-lg">
            <Card className="animate-fade-in">
                <CardHeader>
                    <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-[#004502]/10"><Users className="size-5" /></div>
                    <CardTitle className="text-2xl normal-case tracking-normal text-[#004502]">{t.createGroup.title}</CardTitle>
                    <CardDescription>{t.createGroup.subtitle}</CardDescription>
                </CardHeader>
                <CardContent>
                <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                    <Label htmlFor="group-name">{t.createGroup.nameLabel}</Label>
                    <Input
                        id="group-name"
                        type="text"
                        placeholder={t.createGroup.namePlaceholder}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        autoFocus
                    />
                </div>
                <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={() => navigate('/dashboard')}><ArrowLeft className="size-4" />{t.common.cancel}</Button>
                    <Button type="submit" className="flex-1" disabled={!name.trim() || isCreating}>
                        {isCreating ? t.createGroup.creating : t.createGroup.createButton}
                    </Button>
                </div>
                </form>
                </CardContent>
            </Card>
        </div>
    );
}
