/** Root layout: header with live stats and controls, Kanban board, worker-node strip, event log. */

import styles from './App.module.scss';
import { ControlBar } from './components/ControlBar/ControlBar.js';
import { EventLog } from './components/EventLog/EventLog.js';
import { KanbanBoard } from './components/KanbanBoard/KanbanBoard.js';
import { NodeStrip } from './components/NodeStrip/NodeStrip.js';
import { useOrchestrator } from './state/useOrchestrator.js';

export function App() {
    const { send, status, world } = useOrchestrator();
    const connected = status === 'open';
    return (
        <main className={styles.app}>
            <header className={styles.header}>
                <h1 className={styles.title}>
                    Render Farm <span className={styles.dim}>distributed demo</span>
                </h1>
                <p className={styles.stats}>
                    Cycle #{world.cycle} · {world.totals.done}/{world.totals.total} frames ·{' '}
                    {world.nodes.length} nodes · {world.phase}
                </p>
                <ControlBar phase={world.phase} disabled={!connected} onCommand={send} />
            </header>
            {!connected && (
                <p className={styles.banner} role="status">
                    {status === 'connecting'
                        ? 'Connecting to orchestrator…'
                        : 'Disconnected. Reconnecting…'}
                </p>
            )}
            <KanbanBoard frames={world.frames} />
            <NodeStrip nodes={world.nodes} />
            <EventLog events={world.events} />
        </main>
    );
}
