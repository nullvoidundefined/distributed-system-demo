import { describe, expect, it } from 'vitest';
import type { Command } from '@demo/shared';

import { handleCommand, type CommandDeps } from '../websocket/handleCommand.js';

interface RecordedCalls {
    calls: string[];
    deps: CommandDeps;
    injectedCounts: number[];
}

function recordCommandCalls(): RecordedCalls {
    const calls: string[] = [];
    const injectedCounts: number[] = [];
    const deps: CommandDeps = {
        inject: (count) => {
            calls.push('inject');
            injectedCounts.push(count);
        },
        killNode: () => calls.push('killNode'),
        pause: () => calls.push('pause'),
        reset: () => calls.push('reset'),
        resume: () => calls.push('resume'),
    };
    return { calls, deps, injectedCounts };
}

describe('handleCommand', () => {
    it.each(['pause', 'resume', 'killNode', 'reset'] as const)(
        'routes %s to exactly that dependency',
        (type) => {
            const { calls, deps } = recordCommandCalls();
            handleCommand({ type }, deps);
            expect(calls).toEqual([type]);
        },
    );

    it('routes inject with the requested count', () => {
        const { calls, deps, injectedCounts } = recordCommandCalls();
        handleCommand({ count: 3, type: 'inject' }, deps);
        expect(calls).toEqual(['inject']);
        expect(injectedCounts).toEqual([3]);
    });

    it('defaults inject to 5 frames when no count is given', () => {
        const { deps, injectedCounts } = recordCommandCalls();
        handleCommand({ type: 'inject' }, deps);
        expect(injectedCounts).toEqual([5]);
    });

    it('ignores unknown command types', () => {
        const { calls, deps } = recordCommandCalls();
        handleCommand({ type: 'selfDestruct' } as unknown as Command, deps);
        expect(calls).toEqual([]);
    });
});
