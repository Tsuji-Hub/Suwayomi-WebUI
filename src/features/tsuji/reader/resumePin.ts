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
 * offset inside it) anchored to the top: every size change of the content (ResizeObserver), image load and foreign
 * scroll re-anchors it, until the layout has been stable for RESUME_PIN_STABLE_MS with the target loaded, the user
 * scrolls, swipes, clicks or presses a key, or RESUME_PIN_MAX_MS pass.
 *
 * The in-page offset needs the target's real height, so it only applies once the target image is loaded; until
 * then the pin holds the page top. If the pin ends first (time limit, a click that doesn't scroll), the offset is
 * still applied once when the target loads, as long as the reader still sits at that page top.
 */
export const RESUME_PIN_MAX_MS = 10_000;

/** Quiet time (no resize, load or foreign scroll) after which a pin whose target has loaded is done. */
export const RESUME_PIN_STABLE_MS = 500;

/** Anything that means "the user is moving now": the pin lets go on the first one. */
export const USER_INTENT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

export type ResumePinEndReason = 'user' | 'settled' | 'deadline' | 'stopped';

export type ResumePinLayout = {
    /** Top of the target page in scroll coordinates, null while it isn't rendered. */
    getTargetTop: () => number | null;
    getTargetHeight: () => number;
    /** The target shows its real image (a loading page has a 0 px, hidden image). */
    isTargetLoaded: () => boolean;
    getScrollTop: () => number;
    setScrollTop: (top: number) => void;
};

export class ResumePin {
    private endReason: ResumePinEndReason | null = null;

    private isOffsetSettled: boolean;

    private readonly startedAt: number;

    constructor(
        private readonly layout: ResumePinLayout,
        /** 0-1 inside the target page, applied on top of the page start. */
        private readonly offset: number,
        private readonly now: () => number,
    ) {
        this.startedAt = now();
        this.isOffsetSettled = offset <= 0;
    }

    /** The saved offset is still to be applied (the target hasn't loaded yet). */
    get isOffsetPending(): boolean {
        return !this.isOffsetSettled && this.endReason !== 'stopped';
    }

    /** The target shows its real image, so its height (and the offset inside it) is final. */
    get isTargetLoaded(): boolean {
        return this.layout.isTargetLoaded();
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

    private getWantedTop(top: number, isLoaded: boolean) {
        return Math.round(top + (isLoaded ? this.layout.getTargetHeight() * this.offset : 0));
    }

    /**
     * Scroll so the target spot is at the top: the page top, plus the offset once the target has its real height.
     * Returns false once the pin is over (nothing is moved then).
     */
    anchor(): boolean {
        if (!this.isActive) {
            return false;
        }

        const top = this.layout.getTargetTop();
        if (top === null) {
            return true;
        }

        const isLoaded = this.layout.isTargetLoaded();
        const wanted = this.getWantedTop(top, isLoaded);
        if (isLoaded) {
            this.isOffsetSettled = true;
        }
        if (Math.abs(this.layout.getScrollTop() - wanted) > 1) {
            this.layout.setScrollTop(wanted);
        }

        return true;
    }

    /**
     * After the pin: applies the offset once the target has its real height, if the reader is still at the page top
     * (anything else means the user scrolled, which wins). Returns true when nothing is left to do.
     */
    settleOffset(): boolean {
        if (!this.isOffsetPending) {
            return true;
        }

        const top = this.layout.getTargetTop();
        if (top === null || !this.layout.isTargetLoaded()) {
            return false;
        }

        this.isOffsetSettled = true;
        if (Math.abs(this.layout.getScrollTop() - Math.round(top)) <= 2) {
            this.layout.setScrollTop(this.getWantedTop(top, true));
        }
        return true;
    }
}

type ObserverLike = { observe: (element: Element) => void; disconnect: () => void };

export type ResumePinDeps = {
    createResizeObserver: (callback: () => void) => ObserverLike;
    /** Calls back when the scroll element's children change (e.g. the previous chapter is added above). */
    watchChildren: ((element: Element, callback: () => void) => () => void) | null;
    /**
     * Calls back on the scroll element's scroll events (upstream scrolling to the page top again) and on image loads
     * inside it (a target whose loaded height equals its placeholder causes no resize).
     */
    watchScrollAndLoads: ((element: Element, callback: () => void) => () => void) | null;
    intentTarget: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
    now: () => number;
    /** Runs `callback` after `ms`; returns the cancel function. */
    setTimer: (callback: () => void, ms: number) => () => void;
};

const browserDeps = (): ResumePinDeps => ({
    createResizeObserver: (callback) => new ResizeObserver(callback),
    watchChildren: (element, callback) => {
        const observer = new MutationObserver(callback);
        observer.observe(element, { childList: true });
        return () => observer.disconnect();
    },
    watchScrollAndLoads: (element, callback) => {
        element.addEventListener('scroll', callback, { passive: true });
        element.addEventListener('load', callback, { capture: true });
        return () => {
            element.removeEventListener('scroll', callback);
            element.removeEventListener('load', callback, { capture: true });
        };
    },
    intentTarget: window,
    now: () => performance.now(),
    setTimer: (callback, ms) => {
        const id = window.setTimeout(callback, ms);
        return () => window.clearTimeout(id);
    },
});

const isImageLoaded = (element: HTMLElement): boolean =>
    typeof HTMLImageElement === 'undefined' || !(element instanceof HTMLImageElement)
        ? true
        : element.complete && element.naturalHeight > 0;

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
            isTargetLoaded: () => {
                const target = getTargetElement();
                return !!target && target.getBoundingClientRect().height > 0 && isImageLoaded(target);
            },
            getScrollTop: () => scrollElement.scrollTop,
            setScrollTop: (top) => {
                // oxlint-disable-next-line no-param-reassign
                scrollElement.scrollTop = top;
            },
        },
        offset,
        deps.now,
    );

    setResumeRestore({
        chapterId,
        pageIndex,
        isPinActive: () => pin.isActive,
        isOffsetPending: () => pin.isOffsetPending,
        hasUserMoved: false,
    });

    const observed = new Set<Element>();
    let stopWatchingChildren: (() => void) | null = null;
    let stopWatchingScrollAndLoads: (() => void) | null = null;
    let cancelStableTimer: (() => void) | null = null;
    let cancelDeadline: (() => void) | null = null;
    let isObserving = true;

    const resizeObserver = deps.createResizeObserver(() => onLayoutChange());

    function disconnectObservers() {
        if (isObserving) {
            isObserving = false;
            resizeObserver.disconnect();
            stopWatchingChildren?.();
            stopWatchingScrollAndLoads?.();
            cancelStableTimer?.();
            cancelDeadline?.();
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

    // Pinned with the target loaded (offset applied): done once nothing has moved for RESUME_PIN_STABLE_MS.
    function restartStableTimer() {
        cancelStableTimer?.();
        cancelStableTimer =
            pin.isOffsetPending || !pin.isTargetLoaded
                ? null
                : deps.setTimer(() => {
                      pin.end('settled');
                      onLayoutChange();
                  }, RESUME_PIN_STABLE_MS);
    }

    // While pinned: re-anchor. After the pin: only wait for the target's real height to apply the offset once.
    function onLayoutChange() {
        if (!isObserving) {
            return;
        }
        const wasActive = pin.isActive;
        const isDone = wasActive ? !pin.anchor() : pin.settleOffset();
        if (isDone) {
            disconnectObservers();
            return;
        }
        if (wasActive) {
            restartStableTimer();
        } else {
            cancelStableTimer?.();
            cancelStableTimer = null;
        }
        observeAll();
    }

    cancelDeadline = deps.setTimer(() => {
        pin.end('deadline');
        onLayoutChange();
    }, RESUME_PIN_MAX_MS);

    function removeIntentListeners() {
        USER_INTENT_EVENTS.forEach((type) =>
            deps.intentTarget.removeEventListener(type, onUserIntent, { capture: true }),
        );
    }

    // The observers stay while the offset is pending; settleOffset() skips it if this intent did scroll.
    function onUserIntent() {
        pin.end('user');
        markResumeUserMoved(chapterId);
        removeIntentListeners();
        onLayoutChange();
    }

    USER_INTENT_EVENTS.forEach((type) =>
        deps.intentTarget.addEventListener(type, onUserIntent, { capture: true, passive: true }),
    );
    stopWatchingChildren = deps.watchChildren?.(scrollElement, onLayoutChange) ?? null;
    stopWatchingScrollAndLoads = deps.watchScrollAndLoads?.(scrollElement, onLayoutChange) ?? null;

    // ResizeObserver also reports each element once when it starts observing it, which re-anchors after layout.
    observeAll();
    onLayoutChange();

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
