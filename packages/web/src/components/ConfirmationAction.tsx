import type { ReactElement } from 'react';
import { useI18n } from '../i18n';
import { Button } from '@/components/ui/button';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export function ConfirmationAction({ description, children, onConfirm, destructive = false }: {
    description: string;
    children: ReactElement;
    onConfirm: () => void | Promise<void>;
    destructive?: boolean;
}) {
    const { t } = useI18n();
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t.common.confirmTitle}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild><Button variant="ghost">{t.common.cancel}</Button></AlertDialogCancel>
                    <AlertDialogAction asChild><Button variant={destructive ? 'destructive' : 'default'} onClick={() => void onConfirm()}>{t.common.confirm}</Button></AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
