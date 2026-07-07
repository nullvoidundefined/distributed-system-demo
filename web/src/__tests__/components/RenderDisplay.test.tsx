import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Frame, Stage } from '@demo/shared';
import { RenderDisplay } from '../../components/RenderDisplay/RenderDisplay.js';

function queuedFrame(id: string, priority: boolean): Frame {
    return { cycle: 1, failed: false, id, nodeId: null, pct: 0, priority, stage: 'QUEUED' };
}

function stagedFrame(id: string, stage: Stage, nodeId: string | null): Frame {
    return { cycle: 1, failed: false, id, nodeId, pct: 50, priority: false, stage };
}

function getColumn(stage: Stage): HTMLElement {
    const heading = screen.getByRole('heading', { name: new RegExp(`^${stage}`) });
    return heading.closest('div')!;
}

describe('RenderDisplay', () => {
    it('renders priority frames ahead of normal frames within a column', () => {
        render(
            <RenderDisplay
                frames={[queuedFrame('f-normal', false), queuedFrame('f-priority', true)]}
            />,
        );
        const texts = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
        const priorityIndex = texts.findIndex((text) => text.includes('f-priority'));
        const normalIndex = texts.findIndex((text) => text.includes('f-normal'));
        expect(priorityIndex).toBeGreaterThanOrEqual(0);
        expect(priorityIndex).toBeLessThan(normalIndex);
    });

    it('places each frame in the column matching its stage', () => {
        render(
            <RenderDisplay
                frames={[
                    stagedFrame('f-queued', 'QUEUED', null),
                    stagedFrame('f-rendering', 'RENDERING', 'node-1'),
                    stagedFrame('f-compositing', 'COMPOSITING', 'node-2'),
                    stagedFrame('f-done', 'DONE', null),
                ]}
            />,
        );
        expect(within(getColumn('QUEUED')).getByText('f-queued')).toBeDefined();
        expect(within(getColumn('RENDERING')).getByText('f-rendering')).toBeDefined();
        expect(within(getColumn('COMPOSITING')).getByText('f-compositing')).toBeDefined();
        expect(within(getColumn('DONE')).getByText('f-done')).toBeDefined();
    });

    it('shows a priority badge only on high-priority frames', () => {
        render(
            <RenderDisplay
                frames={[queuedFrame('f-normal', false), queuedFrame('f-priority', true)]}
            />,
        );
        const badges = screen.getAllByLabelText('high priority');
        expect(badges).toHaveLength(1);
        expect(badges[0].closest('li')?.textContent).toContain('f-priority');
    });

    it('marks a permanently failed frame with a failed badge in the DONE column', () => {
        render(
            <RenderDisplay
                frames={[
                    { ...stagedFrame('f-failed', 'DONE', 'node-2'), failed: true },
                    stagedFrame('f-ok', 'DONE', null),
                ]}
            />,
        );
        const badges = screen.getAllByLabelText('failed permanently');
        expect(badges).toHaveLength(1);
        const failedCard = badges[0].closest('li')!;
        expect(failedCard.textContent).toContain('f-failed');
        expect(within(getColumn('DONE')).getByText('f-failed')).toBeDefined();
    });

    it('tags in-flight cards with the owning node', () => {
        render(<RenderDisplay frames={[stagedFrame('f-busy', 'RENDERING', 'node-3')]} />);
        const card = screen.getByText('f-busy').closest('li')!;
        expect(within(card).getByText('node-3')).toBeDefined();
    });
});
