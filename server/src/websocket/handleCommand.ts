/** Routes a client Command to the orchestrator and node pool (same path the autonomous orchestrator uses). */

import type { Command } from '@demo/shared';

export interface CommandDeps {
    pause: () => void;
    resume: () => void;
    inject: (count: number) => void;
    killNode: () => void;
    reset: () => void;
}

export function handleCommand(cmd: Command, deps: CommandDeps): void {
    if (cmd.type === 'pause') return deps.pause();
    if (cmd.type === 'resume') return deps.resume();
    if (cmd.type === 'inject') return deps.inject(cmd.count ?? 5);
    if (cmd.type === 'killNode') return deps.killNode();
    if (cmd.type === 'reset') return deps.reset();
}
