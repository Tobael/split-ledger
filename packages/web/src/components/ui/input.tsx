import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
    return <input data-slot="input" type={type} className={cn('h-10 w-full rounded-lg border border-[#004502]/15 bg-white px-3 text-sm text-[#004502] outline-none transition-shadow placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-[#004502]/30 disabled:opacity-50', className)} {...props} />;
}
