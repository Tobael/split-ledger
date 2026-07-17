import { useApp } from "../context/AppContext";

export function ConnectionStatus() {
    const { syncStatus } = useApp();
    const syncColor = syncStatus === "connected"
        ? "bg-emerald-600 shadow-[0_0_6px_rgba(5,150,105,0.7)]"
        : syncStatus === "connecting" || syncStatus === "reconnecting"
            ? "bg-amber-600"
            : "bg-gray-400";

    return (
        <span
            role="status"
            aria-label={`Relay ${syncStatus}`}
            title={`Relay: ${syncStatus}`}
            className={`inline-block size-2 rounded-full ${syncColor}`}
        />
    );
}
