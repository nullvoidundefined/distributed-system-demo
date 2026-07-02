import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Frame } from '@demo/shared';
import { KanbanBoard } from '../../components/KanbanBoard/KanbanBoard.js';

function queuedFrame(id: string, priority: boolean): Frame {
    return { cycle: 1, id, nodeId: null, pct: 0, priority, stage: 'QUEUED' };
}

describe('KanbanBoard', () => {
    it('renders priority frames ahead of normal frames within a column', () => {
        render(
            <KanbanBoard frames={[queuedFrame('f-normal', false), queuedFrame('f-priority', true)]} />,
        );
        const texts = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
        const priorityIndex = texts.findIndex((text) => text.includes('f-priority'));
        const normalIndex = texts.findIndex((text) => text.includes('f-normal'));
        expect(priorityIndex).toBeGreaterThanOrEqual(0);
        expect(priorityIndex).toBeLessThan(normalIndex);
    });
});
