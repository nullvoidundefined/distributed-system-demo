/** Worker-node strip: one card per live process with status, current frame, and progress. */

import type { WorkerNode } from '@demo/shared';
import styles from './NodeStrip.module.scss';

interface Props {
    nodes: WorkerNode[];
}

export function NodeStrip({ nodes }: Props) {
    return (
        <section className={styles.strip} aria-label="worker nodes">
            {nodes.map((node) => (
                <article key={node.id} className={`${styles.node} ${styles[node.state] ?? ''}`}>
                    <header className={styles.head}>
                        <strong>{node.id}</strong>
                        <span className={styles.pid}>pid {node.pid}</span>
                    </header>
                    <div className={styles.state}>{node.state}</div>
                    <div className={styles.frame}>{node.frameId ?? 'idle'}</div>
                    <div className={styles.track}>
                        <span
                            className={styles.fill}
                            style={{ width: `${node.pct}%` }}
                            aria-hidden="true"
                        />
                    </div>
                    <footer className={styles.done}>{node.completed} done</footer>
                </article>
            ))}
        </section>
    );
}
