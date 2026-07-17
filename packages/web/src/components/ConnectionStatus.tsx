import { useApp } from "../context/AppContext";

export function ConnectionStatus() {
    const { syncStatus } = useApp();
    const syncColor = syncStatus === "connected"
        ? "var(--success)"
        : syncStatus === "connecting" || syncStatus === "reconnecting"
            ? "var(--warning, orange)"
            : "var(--text-tertiary)";

    return (
        <span
            role="status"
            aria-label={`Relay ${syncStatus}`}
            title={`Relay: ${syncStatus}`}
            className="inline-block size-2 rounded-full"
            style={{
                background: syncColor,
                boxShadow: syncStatus === "connected" ? `0 0 6px ${syncColor}` : "none",
            }}
        />
    );
}
