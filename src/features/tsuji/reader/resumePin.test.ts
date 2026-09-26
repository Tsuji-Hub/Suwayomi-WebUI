/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getPageOffset, readPageOffset, writePageOffset } from '@/features/tsuji/reader/pageOffsets.ts';
import type { ResumePinDeps } from '@/features/tsuji/reader/resumePin.ts';
import { RESUME_PIN_MAX_MS, startResumePin } from '@/features/tsuji/reader/resumePin.ts';
import {
    clearResumeRestore,
    isResumeSettling,
    shouldSkipTsujiProgressWrite,
} from '@/features/tsuji/reader/resumeState.ts';

const CHAPTER_ID = 42;
const VIEWPORT = 900;
/** The owner's case: lastPageRead = 5, which sits at ~7000 px once everything above has loaded. */
const TARGET = 5;
const LOADED_HEIGHTS = [1400, 1400, 1400, 1400, 1400, 1600, 1500, 1500];
const GAP = 0;
/** Height of a page's loading placeholder (the reader uses the viewport height); its image reports 0 px meanwhile. */
const PLACEHOLDER = 900;

const rect = (top: number, height: number) => ({ top, height }) as DOMRect;

/**
 * A webtoon strip whose images have no height until they load (like the reader's lazy pages), a scroll element
 * that clamps scrollTop to the content, a ResizeObserver that fires when a page loads, and a stand-in for
 * upstream's scroll handler that picks the first visible page and "writes" lastPageRead unless the guard skips it.
 */
const createReader = () => {
    const loaded = LOADED_HEIGHTS.map(() => false);
    const heights = LOADED_HEIGHTS.map(() => PLACEHOLDER);
    let scrollTop = 0;
    let time = 0;
    const writes: number[] = [];
    const resizeCallbacks: (() => void)[] = [];
    const scrollCallbacks: (() => void)[] = [];
    const intentTarget = new EventTarget();

    const pageTop = (index: number) => heights.slice(0, index).reduce((sum, height) => sum + height + GAP, 0);
    const contentHeight = () => pageTop(heights.length);

    // Upstream debounces the write by 1 s and runs the guard when it fires: `flush` is that moment.
    let pending: number | null = null;
    const onScroll = () => {
        // Upstream: first page whose bottom is below the viewport top.
        pending = Math.max(
            0,
            heights.findIndex((_, index) => pageTop(index) + heights[index] > scrollTop),
        );
    };
    const flush = () => {
        if (pending !== null && !shouldSkipTsujiProgressWrite(CHAPTER_ID, pending)) {
            writes.push(pending);
        }
        pending = null;
    };

    const setScrollTop = (top: number) => {
        const next = Math.max(0, Math.min(top, Math.max(0, contentHeight() - VIEWPORT)));
        if (next === scrollTop) {
            return;
        }
        scrollTop = next;
        onScroll();
        [...scrollCallbacks].forEach((callback) => callback());
    };

    const pageElements = heights.map(
        (_, index) =>
            ({
                getBoundingClientRect: () => rect(pageTop(index) - scrollTop, loaded[index] ? heights[index] : 0),
            }) as HTMLElement,
    );
    const chapterBox = { getBoundingClientRect: () => rect(-scrollTop, contentHeight()) } as Element;
    const scrollElement = {
        children: [chapterBox],
        getBoundingClientRect: () => rect(0, VIEWPORT),
        get scrollTop() {
            return scrollTop;
        },
        set scrollTop(top: number) {
            setScrollTop(top);
        },
    } as unknown as HTMLElement;

    const deps: ResumePinDeps = {
        createResizeObserver: (callback) => {
            resizeCallbacks.push(callback);
            return {
                observe: () => {},
                disconnect: () => resizeCallbacks.splice(resizeCallbacks.indexOf(callback), 1),
            };
        },
        watchChildren: null,
        watchScrollAndLoads: (_, callback) => {
            scrollCallbacks.push(callback);
            return () => scrollCallbacks.splice(scrollCallbacks.indexOf(callback), 1);
        },
        intentTarget,
        now: () => time,
    };

    return {
        writes,
        get scrollTop() {
            return scrollTop;
        },
        pageTop,
        /** Upstream's one-shot scrollIntoView on the target, while the pages above still have no height. */
        upstreamInitialScroll: () => setScrollTop(pageTop(TARGET)),
        loadPage: (index: number) => {
            loaded[index] = true;
            heights[index] = LOADED_HEIGHTS[index];
            resizeCallbacks.forEach((callback) => callback());
        },
        /** Upstream scrolling to the page top on its own (e.g. a pageToScrollToIndex after settings load). */
        upstreamScrollToTarget: () => setScrollTop(pageTop(TARGET)),
        intent: (type: string) => intentTarget.dispatchEvent(new Event(type)),
        userScrollTo: (top: number, intent = 'wheel') => {
            intentTarget.dispatchEvent(new Event(intent));
            setScrollTop(top);
        },
        flush,
        advance: (ms: number) => {
            time += ms;
        },
        start: (offset = 0) =>
            startResumePin(
                {
                    chapterId: CHAPTER_ID,
                    pageIndex: TARGET,
                    offset,
                    scrollElement,
                    getTargetElement: () => pageElements[TARGET],
                },
                deps,
            ),
    };
};

afterEach(() => clearResumeRestore(CHAPTER_ID));

describe('resume pin with lazy images of unknown height', () => {
    it('reproduces the bug without the pin: lands short and saves a lower page', () => {
        const reader = createReader();
        reader.upstreamInitialScroll();
        [0, 1, 2, 3, 4, 5, 6, 7].forEach(reader.loadPage);
        reader.userScrollTo(reader.scrollTop + 10);
        reader.flush();

        expect(reader.scrollTop).toBeLessThan(reader.pageTop(TARGET));
        expect(reader.writes.at(-1)).toBeLessThan(TARGET);
    });

    it('ends on the target page top however the images above load', () => {
        const reader = createReader();
        reader.upstreamInitialScroll();
        const { pin } = reader.start();

        [6, 2, 5, 0, 7, 4, 1, 3].forEach(reader.loadPage);

        expect(reader.pageTop(TARGET)).toBe(7000);
        expect(reader.scrollTop).toBe(7000);
        expect(pin.isActive).toBe(true);
    });

    it('applies the saved in-page offset on top of the page start', () => {
        const reader = createReader();
        reader.start(0.25);
        [0, 1, 2, 3, 4, 5, 6, 7].forEach(reader.loadPage);

        expect(reader.scrollTop).toBe(7000 + 0.25 * 1600);
    });

    it('lets go after 8 s without any timer', () => {
        const reader = createReader();
        const { pin } = reader.start();
        [0, 1, 2].forEach(reader.loadPage);
        reader.advance(RESUME_PIN_MAX_MS);
        const before = reader.scrollTop;
        [3, 4, 5].forEach(reader.loadPage);

        expect(pin.isActive).toBe(false);
        expect(pin.endedBy).toBe('deadline');
        expect(reader.scrollTop).toBe(before);
    });
});

describe("in-page offset needs the target's real height", () => {
    // Pages above the target stay unloaded placeholders, like on the owner's server.
    it('holds the page top until the target loads, then applies the offset, whatever is above', () => {
        const reader = createReader();
        reader.start(0.25);
        expect(reader.scrollTop).toBe(5 * PLACEHOLDER);

        reader.loadPage(5);
        expect(reader.scrollTop).toBe(5 * PLACEHOLDER + 0.25 * 1600);

        [0, 1, 2, 3, 4].forEach(reader.loadPage);
        expect(reader.scrollTop).toBe(7000 + 0.25 * 1600);
    });

    it('re-anchors when upstream scrolls back to the page top while pinned', () => {
        const reader = createReader();
        reader.start(0.25);
        reader.loadPage(5);

        reader.upstreamScrollToTarget();

        expect(reader.scrollTop).toBe(5 * PLACEHOLDER + 0.25 * 1600);
    });

    it('applies the offset once when the target loads after the 8 s limit', () => {
        const reader = createReader();
        const { pin } = reader.start(0.25);
        reader.advance(RESUME_PIN_MAX_MS);
        expect(reader.scrollTop).toBe(5 * PLACEHOLDER);

        reader.loadPage(5);

        expect(pin.endedBy).toBe('deadline');
        expect(reader.scrollTop).toBe(5 * PLACEHOLDER + 0.25 * 1600);
    });

    it('applies the offset after a click that did not scroll', () => {
        const reader = createReader();
        reader.start(0.25);

        reader.intent('pointerdown');
        reader.loadPage(5);

        expect(reader.scrollTop).toBe(5 * PLACEHOLDER + 0.25 * 1600);
    });

    it('leaves the reader alone if the user scrolled before the target loaded', () => {
        const reader = createReader();
        reader.start(0.25);

        reader.userScrollTo(3000);
        reader.loadPage(5);
        reader.loadPage(6);

        expect(reader.scrollTop).toBe(3000);
    });

    it('does not save over the offset while it is pending', () => {
        const reader = createReader();
        reader.start(0.25);
        reader.advance(RESUME_PIN_MAX_MS);

        expect(isResumeSettling(CHAPTER_ID)).toBe(true);
        reader.loadPage(5);
        expect(isResumeSettling(CHAPTER_ID)).toBe(false);
    });
});

describe('user scroll cancels the pin', () => {
    it('stops re-anchoring after a wheel event', () => {
        const reader = createReader();
        const { pin } = reader.start();
        [0, 1, 2, 3, 4, 5, 6, 7].forEach(reader.loadPage);
        expect(reader.scrollTop).toBe(7000);

        reader.userScrollTo(6000);
        // A late resize (e.g. an image re-decoding) must not pull the reader back.
        reader.loadPage(0);

        expect(pin.endedBy).toBe('user');
        expect(reader.scrollTop).toBe(6000);
    });

    it.each(['touchstart', 'pointerdown', 'keydown'])('also on %s', (intent) => {
        const reader = createReader();
        const { pin } = reader.start();
        [0, 1, 2, 3, 4, 5, 6, 7].forEach(reader.loadPage);

        reader.userScrollTo(6500, intent);
        reader.loadPage(1);

        expect(pin.endedBy).toBe('user');
        expect(reader.scrollTop).toBe(6500);
    });
});

describe('no lower lastPageRead written during restore', () => {
    it('skips every write while pinned, then only writes what the user reads', () => {
        const reader = createReader();
        reader.upstreamInitialScroll();
        reader.start();
        [6, 2, 5, 0, 7, 4, 1, 3].forEach((index) => {
            reader.loadPage(index);
            reader.flush();
        });

        expect(reader.writes).toEqual([]);

        reader.userScrollTo(5600); // back to page 4 on purpose
        reader.flush();
        expect(reader.writes).toEqual([4]);
    });

    it('keeps blocking lower pages after the deadline until the user moves', () => {
        const reader = createReader();
        reader.start();
        reader.advance(RESUME_PIN_MAX_MS);

        expect(shouldSkipTsujiProgressWrite(CHAPTER_ID, 3)).toBe(true);
        expect(shouldSkipTsujiProgressWrite(CHAPTER_ID, 5)).toBe(false);
        expect(shouldSkipTsujiProgressWrite(CHAPTER_ID, 6)).toBe(false);
        expect(shouldSkipTsujiProgressWrite(CHAPTER_ID + 1, 0)).toBe(false);

        reader.userScrollTo(0);
        expect(shouldSkipTsujiProgressWrite(CHAPTER_ID, 3)).toBe(false);
    });

    it('stop() (reader unmount) clears the guard', () => {
        const reader = createReader();
        const { stop } = reader.start();
        expect(shouldSkipTsujiProgressWrite(CHAPTER_ID, 5)).toBe(true);
        stop();
        expect(shouldSkipTsujiProgressWrite(CHAPTER_ID, 0)).toBe(false);
    });
});

const createStorage = () => {
    const data = new Map<string, string>();
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
            data.set(key, value);
        },
    };
};

describe('in-page offset storage', () => {
    it('computes a clamped 0-1 offset', () => {
        expect(getPageOffset(7400, 7000, 1600)).toBe(0.25);
        expect(getPageOffset(6900, 7000, 1600)).toBe(0);
        expect(getPageOffset(9000, 7000, 1600)).toBe(1);
        expect(getPageOffset(7000, 7000, 0)).toBe(0);
    });

    it('round-trips per chapter and only applies on the saved page', () => {
        const storage = createStorage();
        writePageOffset(storage, 42, 5, 0.25);
        writePageOffset(storage, 43, 2, 0.5);

        expect(readPageOffset(storage, 42, 5)).toBe(0.25);
        expect(readPageOffset(storage, 42, 4)).toBe(0);
        expect(readPageOffset(storage, 43, 2)).toBe(0.5);
        expect(readPageOffset(storage, 44, 0)).toBe(0);
    });

    it('keeps the 200 most recently read chapters', () => {
        const storage = createStorage();
        for (let id = 1; id <= 205; id += 1) {
            writePageOffset(storage, id, 1, 0.5);
        }
        writePageOffset(storage, 3, 1, 0.75); // 3 is read again, so it survives the next trims
        writePageOffset(storage, 206, 1, 0.5);

        expect(readPageOffset(storage, 3, 1)).toBe(0.75);
        expect(readPageOffset(storage, 7, 1)).toBe(0);
        expect(readPageOffset(storage, 8, 1)).toBe(0.5);
        expect(readPageOffset(storage, 206, 1)).toBe(0.5);
    });

    it('survives a corrupt value', () => {
        const storage = createStorage();
        storage.setItem('tsuji_readerPageOffsets', '{oops');
        expect(readPageOffset(storage, 1, 0)).toBe(0);
        writePageOffset(storage, 1, 0, 0.5);
        expect(readPageOffset(storage, 1, 0)).toBe(0.5);
    });
});
