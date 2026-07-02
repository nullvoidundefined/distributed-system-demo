/** Root layout: header with live stats and controls, Kanban board, worker-node strip, event log. */

import { ControlBar } from './components/ControlBar/ControlBar.js';
import { EventLog } from './components/EventLog/EventLog.js';
import { KanbanBoard } from './components/KanbanBoard/KanbanBoard.js';
import { NodeStrip } from './components/NodeStrip/NodeStrip.js';
import { useCommands } from './state/useCommands.js';
import { useWorldState } from './state/useWorldState.js';
import styles from './App.module.scss';

export function App() {
    const world = useWorldState();
    const send = useCommands();
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
                <ControlBar phase={world.phase} onCommand={send} />
            </header>
            <KanbanBoard frames={world.frames} />
            <NodeStrip nodes={world.nodes} />
            <EventLog events={world.events} />
        </main>
    );
}
