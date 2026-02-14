import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

export function Footer() {
    const { t } = useI18n();

    return (
        <footer style={{
            padding: 'var(--space-8) var(--space-6)',
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--font-size-xs)',
            marginTop: 'auto',
            borderTop: '1px solid var(--glass-border)',
        }}>
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 'var(--space-4)',
                marginBottom: 'var(--space-2)'
            }}>
                <Link to="/impressum" style={{ color: 'inherit', textDecoration: 'none' }}>{t.footer.impressum}</Link>
                <span>&middot;</span>
                <Link to="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>{t.footer.privacy}</Link>
            </div>
            <div style={{ opacity: 0.7 }}>
                &copy; {new Date().getFullYear()} Fair Money
            </div>
        </footer>
    );
}
