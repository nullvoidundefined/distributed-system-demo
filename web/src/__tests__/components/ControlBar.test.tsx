import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Command } from '@demo/shared';
import { ControlBar } from '../../components/ControlBar/ControlBar.js';

function renderControlBar(phase: 'running' | 'paused', disabled = false): Command[] {
    const sentCommands: Command[] = [];
    render(
        <ControlBar
            disabled={disabled}
            onCommand={(cmd) => sentCommands.push(cmd)}
            phase={phase}
        />,
    );
    return sentCommands;
}

describe('ControlBar', () => {
    it('sends pause, inject 5, killNode, and reset commands', () => {
        const sentCommands = renderControlBar('running');
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        fireEvent.click(screen.getByRole('button', { name: '+ Inject 5' }));
        fireEvent.click(screen.getByRole('button', { name: 'Kill a node' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        expect(sentCommands).toEqual([
            { type: 'pause' },
            { count: 5, type: 'inject' },
            { type: 'killNode' },
            { type: 'reset' },
        ]);
    });

    it('offers Resume while paused and sends the resume command', () => {
        const sentCommands = renderControlBar('paused');
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        expect(sentCommands).toEqual([{ type: 'resume' }]);
    });

    it('disables every control while disconnected', () => {
        renderControlBar('running', true);
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(4);
        expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    });
});
