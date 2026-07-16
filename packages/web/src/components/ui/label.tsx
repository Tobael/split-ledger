import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
    return <label data-slot="label" className={cn('mb-1.5 block text-sm font-medium text-[#716969]', className)} {...props} />;
}
