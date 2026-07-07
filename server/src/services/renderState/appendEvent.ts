/** Appends a log event to the RenderState, keeping the rolling log capped and its ids monotonic. */

import type { EventLevel, RenderState } from '@demo/shared';

const MAX_EVENTS = 200; // rolling event-log cap

export function appendEvent(state: RenderState, level: EventLevel, message: string): RenderState {
    const nextId = (state.events.at(-1)?.id ?? 0) + 1;
    const events = [...state.events, { id: nextId, level, message, ts: Date.now() }];
    return { ...state, events: events.slice(-MAX_EVENTS) };
}
