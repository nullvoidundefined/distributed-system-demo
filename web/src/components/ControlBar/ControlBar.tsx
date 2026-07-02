/** Operator controls: pause/resume, inject frames, kill a node, reset the cycle. */

import type { Command, WorldState } from '@demo/shared';
import styles from './ControlBar.module.scss';

interface Props {
    onCommand: (cmd: Command) => void;
    phase: WorldState['phase'];
}

export function ControlBar({ onCommand, phase }: Props) {
    const paused = phase === 'paused';
    return (
        <div className={styles.bar}>
            <button type="button" onClick={() => onCommand({ type: paused ? 'resume' : 'pause' })}>
                {paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" onClick={() => onCommand({ type: 'inject', count: 5 })}>
                + Inject 5
            </button>
            <button type="button" onClick={() => onCommand({ type: 'killNode' })}>
                Kill a node
            </button>
            <button type="button" onClick={() => onCommand({ type: 'reset' })}>
                Reset
            </button>
        </div>
    );
}
