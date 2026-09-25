/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { CompactList, ListStatus, MyListResponse } from '@/features/tsuji/seen/myList.ts';
import { parseMediaListCollection } from '@/features/tsuji/seen/myList.ts';
import type { SeenMarks } from '@/features/tsuji/seen/seen.ts';
import {
    applySeenPatch,
    createSeenUpdater,
    createUndoPatch,
    getSeenBadge,
    getSeenState,
    isHiddenBySeen,
    parseSeenMarks,
} from '@/features/tsuji/seen/seen.ts';

describe('parseMediaListCollection', () => {
    const response: MyListResponse = {
        MediaListCollection: {
            lists: [
                { isCustomList: true, entries: [{ mediaId: 1, status: 'PLANNING', progress: 0 }] },
                {
                    isCustomList: false,
                    entries: [
                        { mediaId: 1, status: 'CURRENT', progress: 45 },
                        { mediaId: 2, status: 'COMPLETED', progress: 120 },
                        { mediaId: 3, status: 'BOGUS', progress: 1 },
                        null,
                        { mediaId: null, status: 'DROPPED', progress: 0 },
                        { mediaId: 4, status: 'PAUSED', progress: null },
                    ],
                },
                null,
            ],
        },
    };

    it('flattens lists to mediaId -> [status, progress], standard lists winning', () =>
        expect(parseMediaListCollection(response)).toEqual({
            1: ['CURRENT', 45],
            2: ['COMPLETED', 120],
            4: ['PAUSED', 0],
        }));

    it('handles a missing collection', () =>
        expect(parseMediaListCollection({ MediaListCollection: null })).toEqual({}));
});

describe('parseSeenMarks', () => {
    it('keeps only positive ids with read/skip', () =>
        expect(parseSeenMarks(JSON.stringify({ 10: 'read', 11: 'skip', 12: 'maybe', abc: 'read', 0: 'read' }))).toEqual(
            {
                10: 'read',
                11: 'skip',
            },
        ));

    it('survives missing or broken values', () => {
        expect(parseSeenMarks(undefined)).toEqual({});
        expect(parseSeenMarks('{oops')).toEqual({});
        expect(parseSeenMarks('[1,2]')).toEqual({});
    });
});

describe('hide rules', () => {
    const list: CompactList = {
        1: ['CURRENT', 45],
        2: ['COMPLETED', 120],
        3: ['DROPPED', 3],
        4: ['PAUSED', 9],
        5: ['REPEATING', 2],
        6: ['PLANNING', 0],
    };
    const marks: SeenMarks = { 7: 'read', 8: 'skip', 6: 'read' };
    const on = { hideOnMyList: true, hidePlanned: false };
    const hidden = (id: number, filters = on) => isHiddenBySeen(getSeenState(id, list, marks), filters);

    it.each<[number, ListStatus]>([
        [1, 'CURRENT'],
        [2, 'COMPLETED'],
        [3, 'DROPPED'],
        [4, 'PAUSED'],
        [5, 'REPEATING'],
    ])('hides %i (%s)', (id) => expect(hidden(id)).toBe(true));

    it('keeps Planned visible unless "also hide Planned" is on', () => {
        const plannedOnly = (filters: typeof on) => isHiddenBySeen(getSeenState(6, list, {}), filters);

        expect(plannedOnly(on)).toBe(false);
        expect(plannedOnly({ hideOnMyList: true, hidePlanned: true })).toBe(true);
    });

    it('hides manual read and not-interested marks, and a mark wins over the list status', () => {
        expect(hidden(7)).toBe(true);
        expect(hidden(8)).toBe(true);
        expect(getSeenState(6, list, marks)).toEqual({ source: 'mark', mark: 'read' });
        expect(hidden(6)).toBe(true);
    });

    it('shows everything with the filter off, and unknown titles always', () => {
        expect(hidden(2, { hideOnMyList: false, hidePlanned: true })).toBe(false);
        expect(hidden(99)).toBe(false);
    });
});

describe('getSeenBadge', () => {
    it('shows reading progress over the known chapter count', () =>
        expect(getSeenBadge({ source: 'list', status: 'CURRENT', progress: 45 }, 120)).toEqual({
            kind: 'reading',
            progress: 45,
            total: 120,
        }));

    it('drops an unknown or smaller total', () => {
        expect(getSeenBadge({ source: 'list', status: 'CURRENT', progress: 45 }, null)).toMatchObject({ total: null });
        expect(getSeenBadge({ source: 'list', status: 'REPEATING', progress: 45 }, 30)).toMatchObject({
            kind: 'rereading',
            total: null,
        });
    });

    it('maps the other statuses and marks without progress', () => {
        expect(getSeenBadge({ source: 'list', status: 'COMPLETED', progress: 120 }, 120)).toEqual({
            kind: 'completed',
            progress: null,
            total: null,
        });
        expect(getSeenBadge({ source: 'list', status: 'PLANNING', progress: 0 }, 10)?.kind).toBe('planned');
        expect(getSeenBadge({ source: 'mark', mark: 'skip' }, 10)?.kind).toBe('skip');
        expect(getSeenBadge(null, 10)).toBeNull();
    });
});

describe('merge-on-write for tsuji_seen', () => {
    it('applies a patch: set, replace, remove', () =>
        expect(applySeenPatch({ 1: 'read', 2: 'skip' }, { 2: 'read', 1: null, 3: 'skip' })).toEqual({
            2: 'read',
            3: 'skip',
        }));

    it("keeps another device's mark written between our reads", async () => {
        let server: SeenMarks = { 1: 'read' };
        const update = createSeenUpdater({
            read: () => Promise.resolve({ ...server }),
            write: (marks) => {
                server = marks;
                return Promise.resolve();
            },
        });

        await update({ 2: 'skip' });
        server = { ...server, 3: 'read' }; // the downstairs PC marks something
        await update({ 4: 'read' });

        expect(server).toEqual({ 1: 'read', 2: 'skip', 3: 'read', 4: 'read' });
    });

    it('serializes quick successive updates from the same tab', async () => {
        let server: SeenMarks = {};
        const update = createSeenUpdater({
            read: async () => {
                await new Promise((resolve) => {
                    setTimeout(resolve, 5);
                });
                return { ...server };
            },
            write: async (marks) => {
                server = marks;
            },
        });

        await Promise.all([update({ 1: 'read' }), update({ 2: 'skip' }), update({ 1: null })]);

        expect(server).toEqual({ 2: 'skip' });
    });

    it('undo restores the previous value only while the title still has the undone mark', async () => {
        let server: SeenMarks = { 5: 'skip' };
        const update = createSeenUpdater({
            read: () => Promise.resolve({ ...server }),
            write: (marks) => {
                server = marks;
                return Promise.resolve();
            },
        });

        let previous: SeenMarks[string] | null = null;
        await update((current) => {
            previous = current[5] ?? null;
            return { 5: 'read' };
        });
        await update(createUndoPatch('5', 'read', previous));
        expect(server).toEqual({ 5: 'skip' });

        await update({ 5: 'read' });
        await update({ 5: null }); // a newer action (Unhide) happened before the old toast's Undo
        await update(createUndoPatch('5', 'read', 'skip'));
        expect(server).toEqual({});
    });

    it('supports clear-all from the fresh server value, and keeps working after a failed write', async () => {
        let server: SeenMarks = { 1: 'read', 2: 'skip' };
        let shouldFail = true;
        const update = createSeenUpdater({
            read: () => Promise.resolve({ ...server }),
            write: (marks) => {
                if (shouldFail) {
                    shouldFail = false;
                    return Promise.reject(new Error('offline'));
                }
                server = marks;
                return Promise.resolve();
            },
        });

        await expect(update({ 3: 'read' })).rejects.toThrow('offline');
        await update((current) => Object.fromEntries(Object.keys(current).map((key) => [key, null])));

        expect(server).toEqual({});
    });
});
