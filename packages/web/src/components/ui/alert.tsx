import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div data-slot="alert" role="alert" className={cn('w-full border-b border-amber-600/15 bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-950', className)} {...props} />;
}
