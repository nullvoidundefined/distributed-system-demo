/** Root layout: header with live stats and controls, render display, worker-node strip, event log. */

import styles from './App.module.scss';
import { ControlBar } from './components/ControlBar/ControlBar.js';
import { EventLog } from './components/EventLog/EventLog.js';
import { NodeStrip } from './components/NodeStrip/NodeStrip.js';
import { RenderDisplay } from './components/RenderDisplay/RenderDisplay.js';
import { useOrchestrator } from './state/useOrchestrator.js';

export function App() {
    const { renderState, send, status } = useOrchestrator();
    const connected = status === 'open';
    return (
        <main className={styles.app}>
            <header className={styles.header}>
                <h1 className={styles.title}>
                    Render Farm <span className={styles.dim}>distributed demo</span>
                </h1>
                <p className={styles.stats}>
                    Cycle #{renderState.cycle} · {renderState.totals.done}/
                    {renderState.totals.total} frames · {renderState.nodes.length} nodes ·{' '}
                    {renderState.status}
                </p>
                <ControlBar status={renderState.status} disabled={!connected} onCommand={send} />
            </header>
            {!connected && (
                <p className={styles.banner} role="status">
                    {status === 'connecting'
                        ? 'Connecting to orchestrator…'
                        : 'Disconnected. Reconnecting…'}
                </p>
            )}
            <RenderDisplay frames={renderState.frames} />
            <NodeStrip nodes={renderState.nodes} />
            <EventLog events={renderState.events} />
        </main>
    );
}
