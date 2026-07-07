/** Inserts or replaces a worker node in a node list, matched by id. */

import type { WorkerNode } from '@demo/shared';

export function upsertNode(nodes: WorkerNode[], patch: WorkerNode): WorkerNode[] {
    const exists = nodes.some((node) => node.id === patch.id);
    return exists ? nodes.map((node) => (node.id === patch.id ? patch : node)) : [...nodes, patch];
}
