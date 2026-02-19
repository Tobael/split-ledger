import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export function ConnectionStatus() {
    const { syncStatus, getConnectedGroups } = useApp();
    const [showDebug, setShowDebug] = useState(false);
    const [connectedGroups, setConnectedGroups] = useState<string[]>([]);
    const buttonRef = useRef<HTMLButtonElement>(null);

    const syncColor = syncStatus === 'connected' ? 'var(--success)' :
        syncStatus === 'reconnecting' || syncStatus === 'connecting' ? 'var(--warning, orange)' : 'var(--text-tertiary)';

    const toggleDebug = () => {
        if (!showDebug) {
            setConnectedGroups(getConnectedGroups());
        }
        setShowDebug(!showDebug);
    };

    // Close on click outside
    useEffect(() => {
        if (!showDebug) return;
        const handleClick = (e: MouseEvent) => {
            if (buttonRef.current && !buttonRef.current.contains(e.target as Node) && !(e.target as Element).closest('.debug-popover')) {
                setShowDebug(false);
            }
        };
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, [showDebug]);

    return (
        <div style={{ position: 'relative', display: 'inline-block' }}>
            <button
                ref={buttonRef}
                onClick={toggleDebug}
                title={`Connection: ${syncStatus}. Click for debug info.`}
                style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: syncColor,
                    display: 'block',
                    boxShadow: syncStatus === 'connected' ? `0 0 6px ${syncColor}` : 'none',
                    transition: 'all 0.3s ease',
                }} />
            </button>

            {showDebug && (
                <div className="debug-popover" style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0, // Align right edge with button right edge (or check Layout to align better)
                    left: '50%', // Centered relative to button if we transform
                    transform: 'translateX(-50%)',
                    marginTop: '8px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px',
                    minWidth: '250px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    zIndex: 1000,
                    fontSize: '0.85rem',
                    color: 'var(--text-primary)',
                    backdropFilter: 'blur(10px)',
                }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
                        Connection Debug
                    </h4>
                    <div style={{ marginBottom: '8px' }}>
                        <strong>Status:</strong> <span style={{ color: syncColor }}>{syncStatus}</span>
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                        <strong>Active Subscriptions ({connectedGroups.length}):</strong>
                        <ul style={{
                            margin: '4px 0 0 0',
                            paddingLeft: '16px',
                            maxHeight: '150px',
                            overflowY: 'auto',
                            fontSize: '0.75rem',
                            fontFamily: 'monospace',
                            color: 'var(--text-secondary)'
                        }}>
                            {connectedGroups.length > 0 ? (
                                connectedGroups.map(gid => (
                                    <li key={gid} title={gid}>{gid.slice(0, 8)}...</li>
                                ))
                            ) : (
                                <li>No active subscriptions</li>
                            )}
                        </ul>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '8px', textAlign: 'right' }}>
                        {new Date().toLocaleTimeString()}
                    </div>
                </div>
            )}
        </div>
    );
}
