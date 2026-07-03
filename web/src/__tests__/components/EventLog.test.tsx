import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@demo/shared';
import { EventLog } from '../../components/EventLog/EventLog.js';

function logEvent(id: number, level: LogEvent['level'], message: string): LogEvent {
    return { id, level, message, ts: 1700000000000 + id };
}

describe('EventLog', () => {
    it('renders every event message with a timestamp', () => {
        render(
            <EventLog
                events={[
                    logEvent(1, 'info', 'seeded 16 frames for cycle 1'),
                    logEvent(2, 'danger', 'node-3 crashed (SIGKILL); frame orphaned'),
                ]}
            />,
        );
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(screen.getByText('seeded 16 frames for cycle 1')).toBeDefined();
        expect(screen.getByText('node-3 crashed (SIGKILL); frame orphaned')).toBeDefined();
        expect(rows[0].querySelector('time')).not.toBeNull();
    });

    it('color-codes rows by severity class', () => {
        render(<EventLog events={[logEvent(1, 'danger', 'node-2 crashed')]} />);
        const row = screen.getByText('node-2 crashed').closest('li')!;
        expect(row.className).toMatch(/danger/);
    });
});
