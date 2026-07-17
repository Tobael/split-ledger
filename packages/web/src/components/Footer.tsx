import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

export function Footer() {
    const { t } = useI18n();

    return (
        <footer className="mt-auto border-t border-[#004502]/10 px-6 py-8 text-center text-xs text-[#716969]">
            <div className="mb-2 flex justify-center gap-4">
                <Link to="/impressum" className="hover:text-[#004502] hover:underline">{t.footer.impressum}</Link>
                <span>&middot;</span>
                <Link to="/privacy" className="hover:text-[#004502] hover:underline">{t.footer.privacy}</Link>
            </div>
            <div className="opacity-70">
                &copy; {new Date().getFullYear()} Fair Money
            </div>
        </footer>
    );
}
