/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { clearResumeRestore, markResumeUserMoved, setResumeRestore } from '@/features/tsuji/reader/resumeState.ts';

/**
 * Resume pin for the continuous vertical reader (webtoon / continuous vertical).
 *
 * Upstream scrolls to lastPageRead once, while the pages above it still have no height (their images aren't loaded),
 * so the reader lands short and the next scroll saves a lower page. The pin keeps the target page (plus the saved
 * offset inside it) anchored to the top: every size change of the content re-anchors it, until the user scrolls,
 * swipes, clicks or presses a key, or RESUME_PIN_MAX_MS pass. Driven by ResizeObserver, no timers.
 */
export const RESUME_PIN_MAX_MS = 8000;

/** Anything that means "the user is moving now": the pin lets go on the first one. */
export const USER_INTENT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

export type ResumePinEndReason = 'user' | 'deadline' | 'stopped';

export type ResumePinLayout = {
    /** Top of the target page in scroll coordinates, null while it isn't rendered. */
    getTargetTop: () => number | null;
    getTargetHeight: () => number;
    getScrollTop: () => number;
    setScrollTop: (top: number) => void;
};

export class ResumePin {
    private endReason: ResumePinEndReason | null = null;

    private readonly startedAt: number;

    constructor(
        private readonly layout: ResumePinLayout,
        /** 0-1 inside the target page, applied on top of the page start. */
        private readonly offset: number,
        private readonly now: () => number,
    ) {
        this.startedAt = now();
    }

    get isActive(): boolean {
        if (!this.endReason && this.now() - this.startedAt >= RESUME_PIN_MAX_MS) {
            this.endReason = 'deadline';
        }
        return !this.endReason;
    }

    get endedBy(): ResumePinEndReason | null {
        return this.isActive ? null : this.endReason;
    }

    end(reason: ResumePinEndReason) {
        if (!this.endReason) {
            this.endReason = reason;
        }
    }

    /** Scroll so the target spot is at the top. Returns false once the pin is over (nothing is moved then). */
    anchor(): boolean {
        if (!this.isActive) {
            return false;
        }

        const top = this.layout.getTargetTop();
        if (top === null) {
            return true;
        }

        const wanted = Math.round(top + this.layout.getTargetHeight() * this.offset);
        if (Math.abs(this.layout.getScrollTop() - wanted) > 1) {
            this.layout.setScrollTop(wanted);
        }

        return true;
    }
}

type ObserverLike = { observe: (element: Element) => void; disconnect: () => void };

export type ResumePinDeps = {
    createResizeObserver: (callback: () => void) => ObserverLike;
    /** Calls back when the scroll element's children change (e.g. the previous chapter is added above). */
    watchChildren: ((element: Element, callback: () => void) => () => void) | null;
    intentTarget: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
    now: () => number;
};

const browserDeps = (): ResumePinDeps => ({
    createResizeObserver: (callback) => new ResizeObserver(callback),
    watchChildren: (element, callback) => {
        const observer = new MutationObserver(callback);
        observer.observe(element, { childList: true });
        return () => observer.disconnect();
    },
    intentTarget: window,
    now: () => performance.now(),
});

export type ResumePinOptions = {
    chapterId: number;
    pageIndex: number;
    offset: number;
    scrollElement: HTMLElement;
    getTargetElement: () => HTMLElement | null;
};

/**
 * Starts the pin and registers it for the lastPageRead write guard. Returns the stop function (unmount). The
 * user-intent listeners outlive the pin until the first intent, so the guard knows when the user took over.
 */
export const startResumePin = (
    { chapterId, pageIndex, offset, scrollElement, getTargetElement }: ResumePinOptions,
    deps: ResumePinDeps = browserDeps(),
): { pin: ResumePin; stop: () => void } => {
    const pin = new ResumePin(
        {
            getTargetTop: () => {
                const target = getTargetElement();
                return target
                    ? target.getBoundingClientRect().top -
                          scrollElement.getBoundingClientRect().top +
                          scrollElement.scrollTop
                    : null;
            },
            getTargetHeight: () => getTargetElement()?.getBoundingClientRect().height ?? 0,
            getScrollTop: () => scrollElement.scrollTop,
            setScrollTop: (top) => {
                // oxlint-disable-next-line no-param-reassign
                scrollElement.scrollTop = top;
            },
        },
        offset,
        deps.now,
    );

    setResumeRestore({ chapterId, pageIndex, isPinActive: () => pin.isActive, hasUserMoved: false });

    const observed = new Set<Element>();
    let stopWatchingChildren: (() => void) | null = null;
    let isObserving = true;

    const resizeObserver = deps.createResizeObserver(() => onLayoutChange());

    function disconnectObservers() {
        if (isObserving) {
            isObserving = false;
            resizeObserver.disconnect();
            stopWatchingChildren?.();
        }
    }

    // Every chapter viewer box (their heights include the pages above the target) and the target itself.
    function observeAll() {
        const target = getTargetElement();
        [...Array.from(scrollElement.children), ...(target ? [target] : [])]
            .filter((element) => !observed.has(element))
            .forEach((element) => {
                observed.add(element);
                resizeObserver.observe(element);
            });
    }

    function onLayoutChange() {
        if (!isObserving) {
            return;
        }
        if (!pin.anchor()) {
            disconnectObservers();
            return;
        }
        observeAll();
    }

    function removeIntentListeners() {
        USER_INTENT_EVENTS.forEach((type) =>
            deps.intentTarget.removeEventListener(type, onUserIntent, { capture: true }),
        );
    }

    function onUserIntent() {
        pin.end('user');
        markResumeUserMoved(chapterId);
        disconnectObservers();
        removeIntentListeners();
    }

    USER_INTENT_EVENTS.forEach((type) =>
        deps.intentTarget.addEventListener(type, onUserIntent, { capture: true, passive: true }),
    );
    stopWatchingChildren = deps.watchChildren?.(scrollElement, onLayoutChange) ?? null;

    // ResizeObserver also reports each element once when it starts observing it, which re-anchors after layout.
    observeAll();
    pin.anchor();

    return {
        pin,
        stop: () => {
            pin.end('stopped');
            disconnectObservers();
            removeIntentListeners();
            clearResumeRestore(chapterId);
        },
    };
};
