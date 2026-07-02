/** Worker-node strip: one card per live process with status, current frame, and progress. */

import type { NodeState, WorkerNode } from '@demo/shared';

import styles from './NodeStrip.module.scss';

interface NodeStripProps {
    nodes: WorkerNode[];
}

const STATE_CLASS: Partial<Record<NodeState, string>> = {
    crashed: styles.crashed,
    spawning: styles.spawning,
};

export function NodeStrip({ nodes }: NodeStripProps) {
    return (
        <section className={styles.strip} aria-label="worker nodes">
            {nodes.map((node) => (
                <article key={node.id} className={`${styles.node} ${STATE_CLASS[node.state] ?? ''}`}>
                    <header className={styles.head}>
                        <strong>{node.id}</strong>
                        <span className={styles.pid}>pid {node.pid}</span>
                    </header>
                    <div className={styles.state}>{node.state}</div>
                    <div className={styles.frame}>{node.frameId ?? 'idle'}</div>
                    <div className={styles.track}>
                        <span className={styles.fill} style={{ width: `${node.pct}%` }} aria-hidden="true" />
                    </div>
                    <footer className={styles.done}>{node.completed} done</footer>
                </article>
            ))}
        </section>
    );
}
