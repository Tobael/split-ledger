import type { ReactNode } from 'react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

interface LegalPageProps {
    title: string;
    description: string;
    icon: LucideIcon;
    children: ReactNode;
}

export function LegalPage({ title, description, icon: Icon, children }: LegalPageProps) {
    const { t } = useI18n();

    return (
        <main className="mx-auto w-full max-w-4xl animate-fade-in px-4 py-6 sm:px-6 sm:py-10">
            <Link
                to="/"
                className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-[#716969] hover:bg-[#004502]/5 hover:text-[#004502]"
            >
                <ArrowLeft className="size-4" />
                {t.common.back}
            </Link>

            <article className="overflow-hidden rounded-2xl border border-[#004502]/10 bg-white shadow-sm">
                <header className="border-b border-[#004502]/10 bg-[#f4f8f4] px-5 py-7 sm:px-10 sm:py-9">
                    <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-[#004502]/10 text-[#004502]">
                        <Icon className="size-5" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-[#004502] sm:text-4xl">{title}</h1>
                    <p className="mt-2 max-w-2xl text-sm text-[#716969] sm:text-base">{description}</p>
                </header>
                <div className="legal-document px-5 py-7 sm:px-10 sm:py-10">{children}</div>
            </article>
        </main>
    );
}
