/** Kanban board: one column per stage, frame cards tagged with owning node and priority. */

import type { Frame } from '@demo/shared';
import { STAGES } from '@demo/shared';

import { useFlipAnimation } from '../../state/useFlipAnimation';

import styles from './KanbanBoard.module.scss';

interface KanbanBoardProps {
    frames: Frame[];
}

function cardClassName(frame: Frame): string {
    if (frame.failed) return `${styles.card} ${styles.failed}`;
    if (frame.priority) return `${styles.card} ${styles.priority}`;
    return styles.card;
}

export function KanbanBoard({ frames }: KanbanBoardProps) {
    const registerFlipElement = useFlipAnimation<HTMLLIElement>();
    return (
        <section className={styles.board} aria-label="render pipeline">
            {STAGES.map((stage) => {
                const columnFrames = frames
                    .filter((frame) => frame.stage === stage)
                    .sort((a, b) => Number(b.priority) - Number(a.priority));
                return (
                    <div key={stage} className={styles.column}>
                        <h2 className={styles.columnTitle}>
                            {stage} <span className={styles.count}>{columnFrames.length}</span>
                        </h2>
                        <ul className={styles.cards}>
                            {columnFrames.map((frame) => (
                                <li
                                    key={frame.id}
                                    ref={registerFlipElement(frame.id)}
                                    className={cardClassName(frame)}
                                >
                                    <span>{frame.id}</span>
                                    {frame.failed && (
                                        <span
                                            className={styles.failedBadge}
                                            aria-label="failed permanently"
                                        >
                                            failed
                                        </span>
                                    )}
                                    {frame.priority && !frame.failed && (
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
