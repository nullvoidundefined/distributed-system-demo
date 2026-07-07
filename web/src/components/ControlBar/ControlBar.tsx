/** Operator controls: pause/resume, inject frames, kill a node, reset the cycle. */

import type { Command, RenderState } from '@demo/shared';

import styles from './ControlBar.module.scss';

interface ControlBarProps {
    disabled: boolean;
    onCommand: (cmd: Command) => void;
    status: RenderState['status'];
}

export function ControlBar({ disabled, onCommand, status }: ControlBarProps) {
    const paused = status === 'paused';
    return (
        <div className={styles.bar} role="toolbar" aria-label="Operator controls">
            <button
                type="button"
                className={styles.controlButton}
                disabled={disabled}
                onClick={() => onCommand({ type: paused ? 'resume' : 'pause' })}
            >
                {paused ? 'Resume' : 'Pause'}
            </button>
            <button
                type="button"
                className={styles.controlButton}
                disabled={disabled}
                onClick={() => onCommand({ count: 5, type: 'inject' })}
            >
                + Inject 5
            </button>
            <button
                type="button"
                className={styles.controlButton}
                disabled={disabled}
                onClick={() => onCommand({ type: 'killNode' })}
            >
                Kill a node
            </button>
            <button
                type="button"
                className={styles.controlButton}
                disabled={disabled}
                onClick={() => onCommand({ type: 'reset' })}
            >
                Reset
            </button>
        </div>
    );
}
