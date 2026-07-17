import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;

export function AlertDialogContent({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Content>) {
    return (
        <AlertDialogPrimitive.Portal>
            <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-[1px]" />
            <AlertDialogPrimitive.Content className={cn('fixed top-1/2 left-1/2 z-[101] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#004502]/10 bg-white p-6 shadow-xl', className)} {...props} />
        </AlertDialogPrimitive.Portal>
    );
}

export function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
    return <div className={cn('space-y-2', className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
    return <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Title>) {
    return <AlertDialogPrimitive.Title className={cn('text-lg font-semibold text-[#004502]', className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Description>) {
    return <AlertDialogPrimitive.Description className={cn('text-sm leading-relaxed text-[#716969]', className)} {...props} />;
}
