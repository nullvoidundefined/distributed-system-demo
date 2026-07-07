/** Root layout: header with live stats and controls, Kanban board, worker-node strip, event log. */

import styles from './App.module.scss';
import { ControlBar } from './components/ControlBar/ControlBar.js';
import { EventLog } from './components/EventLog/EventLog.js';
import { KanbanBoard } from './components/KanbanBoard/KanbanBoard.js';
import { NodeStrip } from './components/NodeStrip/NodeStrip.js';
import { useOrchestrator } from './state/useOrchestrator.js';

export function App() {
    const { send, status, renderState } = useOrchestrator();
    const connected = status === 'open';
    return (
        <main className={styles.app}>
            <header className={styles.header}>
                <h1 className={styles.title}>
                    Render Farm <span className={styles.dim}>distributed demo</span>
                </h1>
                <p className={styles.stats}>
                    Cycle #{renderState.cycle} · {renderState.totals.done}/{renderState.totals.total} frames ·{' '}
                    {renderState.nodes.length} nodes · {renderState.phase}
                </p>
                <ControlBar phase={renderState.phase} disabled={!connected} onCommand={send} />
            </header>
            {!connected && (
                <p className={styles.banner} role="status">
                    {status === 'connecting'
                        ? 'Connecting to orchestrator…'
                        : 'Disconnected. Reconnecting…'}
                </p>
            )}
            <KanbanBoard frames={renderState.frames} />
            <NodeStrip nodes={renderState.nodes} />
            <EventLog events={renderState.events} />
        </main>
    );
}
