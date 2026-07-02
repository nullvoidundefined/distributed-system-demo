/** Scrolling, color-coded event log narrating what the graphics show. */

import type { EventLevel, LogEvent } from '@demo/shared';
import styles from './EventLog.module.scss';

interface EventLogProps {
    events: LogEvent[];
}

const LEVEL_CLASS: Record<EventLevel, string> = {
    danger: styles.danger,
    info: styles.info,
    success: styles.success,
    warn: styles.warn,
};

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
}

export function EventLog({ events }: EventLogProps) {
    return (
        <section className={styles.log} aria-label="event log" aria-live="polite">
            <ul className={styles.list}>
                {events.map((event) => (
                    <li key={event.id} className={`${styles.row} ${LEVEL_CLASS[event.level]}`}>
                        <time dateTime={new Date(event.ts).toISOString()}>{formatTime(event.ts)}</time>
                        <span className={styles.message}>{event.message}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
