import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RenderNode } from '@demo/shared';
import { NodeStrip } from '../../components/NodeStrip/NodeStrip.js';

function renderNode(overrides: Partial<RenderNode>): RenderNode {
    return {
        completed: 0,
        frameId: null,
        id: 'node-1',
        pct: 0,
        pid: 101,
        state: 'idle',
        ...overrides,
    };
}

describe('NodeStrip', () => {
    it('renders one card per node with pid, state, current frame, and completed count', () => {
        render(
            <NodeStrip
                nodes={[
                    renderNode({ id: 'node-1', pid: 101 }),
                    renderNode({
                        completed: 3,
                        frameId: 'f7',
                        id: 'node-2',
                        pct: 60,
                        pid: 102,
                        state: 'rendering',
                    }),
                ]}
            />,
        );
        const cards = screen.getAllByRole('article');
        expect(cards).toHaveLength(2);
        const busyCard = cards[1];
        expect(within(busyCard).getByText('node-2')).toBeDefined();
        expect(within(busyCard).getByText('pid 102')).toBeDefined();
        expect(within(busyCard).getByText('rendering')).toBeDefined();
        expect(within(busyCard).getByText('f7')).toBeDefined();
        expect(within(busyCard).getByText('3 done')).toBeDefined();
    });

    it('shows idle in place of a frame when the node holds none', () => {
        render(<NodeStrip nodes={[renderNode({ id: 'node-1', state: 'spawning' })]} />);
        expect(screen.getByText('idle')).toBeDefined();
        expect(screen.getByText('spawning')).toBeDefined();
    });
});
