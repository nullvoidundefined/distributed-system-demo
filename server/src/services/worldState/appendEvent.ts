/** Appends a log event to the WorldState, keeping the rolling log capped and its ids monotonic. */

import type { EventLevel, WorldState } from '@demo/shared';
import { MAX_EVENTS } from './constants.js';

export function appendEvent(state: WorldState, level: EventLevel, message: string): WorldState {
    const nextId = (state.events.at(-1)?.id ?? 0) + 1;
    const events = [...state.events, { id: nextId, ts: Date.now(), level, message }];
    return { ...state, events: events.slice(-MAX_EVENTS) };
}
