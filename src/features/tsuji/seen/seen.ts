/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { CompactList, ListStatus } from '@/features/tsuji/seen/myList.ts';

/** Manual marks from a card: "read" behaves like COMPLETED, "skip" (not interested) like DROPPED. */
export type SeenMark = 'read' | 'skip';

/** `tsuji_seen` global meta: `{ [anilistMediaId]: "read" | "skip" }`, shared by every device. */
export type SeenMarks = Record<string, SeenMark>;

export type SeenState = { source: 'mark'; mark: SeenMark } | { source: 'list'; status: ListStatus; progress: number };

export type SeenFilters = { hideOnMyList: boolean; hidePlanned: boolean };

const isSeenMark = (value: unknown): value is SeenMark => value === 'read' || value === 'skip';

const isMediaIdKey = (key: string) => /^[1-9]\d*$/.test(key);

/** Tolerant parse: drops anything that isn't `positive id -> read | skip`, so a bad value can't break the UI. */
export const parseSeenMarks = (raw: string | undefined): SeenMarks => {
    if (!raw) {
        return {};
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(parsed).filter(
            (entry): entry is [string, SeenMark] => isMediaIdKey(entry[0]) && isSeenMark(entry[1]),
        ),
    );
};

/** A manual mark wins over the AniList status: it's the latest thing the user said about the title. */
export const getSeenState = (mediaId: number, list: CompactList | null, marks: SeenMarks): SeenState | null => {
    const key = String(mediaId);

    const mark = marks[key];
    if (mark) {
        return { source: 'mark', mark };
    }

    const entry = list?.[key];
    return entry ? { source: 'list', status: entry[0], progress: entry[1] } : null;
};

const HIDDEN_LIST_STATUSES: ListStatus[] = ['CURRENT', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'];

/** "Hide what's on my AniList": reading/completed/dropped/paused/rereading and manual marks; Planned only on request. */
export const isHiddenBySeen = (state: SeenState | null, { hideOnMyList, hidePlanned }: SeenFilters): boolean => {
    if (!state || !hideOnMyList) {
        return false;
    }

    if (state.source === 'mark') {
        return true;
    }

    return state.status === 'PLANNING' ? hidePlanned : HIDDEN_LIST_STATUSES.includes(state.status);
};

export type SeenBadgeKind = 'completed' | 'reading' | 'rereading' | 'dropped' | 'paused' | 'planned' | 'read' | 'skip';

export type SeenBadge = { kind: SeenBadgeKind; progress: number | null; total: number | null };

const LIST_BADGE_KIND: Record<ListStatus, SeenBadgeKind> = {
    CURRENT: 'reading',
    REPEATING: 'rereading',
    COMPLETED: 'completed',
    DROPPED: 'dropped',
    PAUSED: 'paused',
    PLANNING: 'planned',
};

/** "Reading 45/120": progress for reading/rereading, total only when AniList knows a chapter count >= progress. */
export const getSeenBadge = (state: SeenState | null, chapters: number | null | undefined): SeenBadge | null => {
    if (!state) {
        return null;
    }

    if (state.source === 'mark') {
        return { kind: state.mark, progress: null, total: null };
    }

    const kind = LIST_BADGE_KIND[state.status];
    const showsProgress = (kind === 'reading' || kind === 'rereading') && state.progress > 0;
    const progress = showsProgress ? state.progress : null;
    const total = progress !== null && chapters && chapters >= progress ? chapters : null;

    return { kind, progress, total };
};

export type SeenPatch = Record<string, SeenMark | null>;

/** Undo of "set `key` to `mark`": restores `previous` only if the title still has `mark` (a newer mark wins). */
export const createUndoPatch =
    (key: string, mark: SeenMark | null, previous: SeenMark | null) =>
    (current: SeenMarks): SeenPatch =>
        (current[key] ?? null) === mark ? { [key]: previous } : {};

export const applySeenPatch = (current: SeenMarks, patch: SeenPatch): SeenMarks => {
    const next: SeenMarks = { ...current };
    Object.entries(patch).forEach(([key, mark]) => {
        if (mark) {
            next[key] = mark;
        } else {
            delete next[key];
        }
    });

    return next;
};

/**
 * Merge-on-write for `tsuji_seen`: every update reads the server's current value first, applies only this
 * change, then writes once, so two devices marking different titles don't clobber each other. Updates from this
 * tab are serialized so quick successive marks can't race each other either.
 */
export const createSeenUpdater = ({
    read,
    write,
}: {
    read: () => Promise<SeenMarks>;
    write: (marks: SeenMarks) => Promise<void>;
}) => {
    let queue: Promise<unknown> = Promise.resolve();

    return (patch: SeenPatch | ((current: SeenMarks) => SeenPatch)): Promise<SeenMarks> => {
        const run = queue.then(async () => {
            const current = await read();
            const next = applySeenPatch(current, typeof patch === 'function' ? patch(current) : patch);
            await write(next);
            return next;
        });
        queue = run.catch(() => undefined);

        return run;
    };
};
