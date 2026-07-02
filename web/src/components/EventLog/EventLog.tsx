/** Scrolling, color-coded event log narrating what the graphics show. */

import type { LogEvent } from '@demo/shared';
import styles from './EventLog.module.scss';

interface Props {
    events: LogEvent[];
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
}

export function EventLog({ events }: Props) {
    return (
        <section className={styles.log} aria-label="event log" aria-live="polite">
            <ul className={styles.list}>
                {[...events].reverse().map((event) => (
                    <li key={event.id} className={`${styles.row} ${styles[event.level]}`}>
                        <time>{formatTime(event.ts)}</time>
                        <span>{event.message}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
