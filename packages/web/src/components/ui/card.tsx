import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div data-slot="card" className={cn('rounded-xl border border-[#004502]/10 bg-white/85 p-6 shadow-sm', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div data-slot="card-header" className={cn('mb-4 flex flex-col gap-1.5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
    return <h3 data-slot="card-title" className={cn('text-sm font-semibold uppercase tracking-wide text-[#716969]', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
    return <p data-slot="card-description" className={cn('text-sm text-[#716969]', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div data-slot="card-content" className={cn(className)} {...props} />;
}
