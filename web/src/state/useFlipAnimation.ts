/**
 * FLIP animation hook: registers elements by id, and on re-render slides any element
 * whose on-screen position changed from its previous position to its new one.
 * Slides become instant state changes under prefers-reduced-motion.
 */

import { useLayoutEffect, useRef } from 'react';

type RegisterFlipElement<T extends HTMLElement> = (id: string) => (element: T | null) => void;

const SLIDE_MS = 300;

export function useFlipAnimation<T extends HTMLElement>(): RegisterFlipElement<T> {
    const elementsById = useRef(new Map<string, T>());
    const previousRectsById = useRef(new Map<string, DOMRect>());

    useLayoutEffect(() => {
        const previousRects = previousRectsById.current;
        const nextRects = new Map<string, DOMRect>();
        for (const [id, element] of elementsById.current) {
            const rect = element.getBoundingClientRect();
            nextRects.set(id, rect);
            const previousRect = previousRects.get(id);
            if (!previousRect) continue;
            slideFromPreviousRect(element, previousRect, rect);
        }
        previousRectsById.current = nextRects;
    });

    return function registerFlipElement(id: string) {
        return (element: T | null) => {
            if (element) elementsById.current.set(id, element);
            else elementsById.current.delete(id);
        };
    };
}

function slideFromPreviousRect(element: HTMLElement, previousRect: DOMRect, rect: DOMRect): void {
    const deltaX = previousRect.left - rect.left;
    const deltaY = previousRect.top - rect.top;
    if ((deltaX === 0 && deltaY === 0) || shouldReduceMotion()) return;
    element.animate(
        [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: 'translate(0, 0)' }],
        { duration: SLIDE_MS, easing: 'ease' },
    );
}

function shouldReduceMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
