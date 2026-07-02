/** Kanban board: one column per stage, frame cards tagged with owning node and priority. */

import type { Frame } from '@demo/shared';
import { STAGES } from '@demo/shared';
import styles from './KanbanBoard.module.scss';

interface Props {
    frames: Frame[];
}

export function KanbanBoard({ frames }: Props) {
    return (
        <section className={styles.board} aria-label="render pipeline">
            {STAGES.map((stage) => {
                const columnFrames = frames.filter((frame) => frame.stage === stage);
                return (
                    <div key={stage} className={styles.column}>
                        <h2 className={styles.columnTitle}>
                            {stage} <span className={styles.count}>{columnFrames.length}</span>
                        </h2>
                        <ul className={styles.cards}>
                            {columnFrames.map((frame) => (
                                <li
                                    key={frame.id}
                                    className={`${styles.card} ${frame.priority ? styles.priority : ''}`}
                                >
                                    <span>{frame.id}</span>
                                    {frame.priority && (
                                        <span className={styles.badge} aria-label="high priority">
                                            priority
                                        </span>
                                    )}
                                    {frame.nodeId && (
                                        <span className={styles.node}>{frame.nodeId}</span>
                                    )}
                                    {frame.pct > 0 && frame.stage !== 'DONE' && (
                                        <span
                                            className={styles.bar}
                                            style={{ width: `${frame.pct}%` }}
                                            aria-hidden="true"
                                        />
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </section>
    );
}
