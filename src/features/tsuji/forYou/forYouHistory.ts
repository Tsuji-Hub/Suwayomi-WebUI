/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * The top picks shown each week, per AniList user, in this browser's localStorage, so next week's ranking can move
 * them down. Only the last few weeks are kept.
 */
export const FOR_YOU_HISTORY_KEY = 'tsuji_forYouShown';
export const HISTORY_WEEKS_KEPT = 3;
export const SHOWN_PER_WEEK = 12;

type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

type History = Record<string, Record<string, number[]>>;

const read = (storage: HistoryStorage): History => {
    try {
        const parsed: unknown = JSON.parse(storage.getItem(FOR_YOU_HISTORY_KEY) ?? '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as History) : {};
    } catch {
        return {};
    }
};

const userKey = (userName: string) => userName.trim().toLowerCase();

export const readShownIds = (storage: HistoryStorage, userName: string, weekKey: string): number[] => {
    const ids = read(storage)[userKey(userName)]?.[weekKey];
    return Array.isArray(ids) ? ids.filter((id) => Number.isInteger(id)) : [];
};

export const writeShownIds = (storage: HistoryStorage, userName: string, weekKey: string, ids: number[]) => {
    const history = read(storage);
    const weeks = { ...history[userKey(userName)], [weekKey]: ids.slice(0, SHOWN_PER_WEEK) };
    // ISO week keys sort chronologically as strings.
    const kept = Object.keys(weeks).sort().slice(-HISTORY_WEEKS_KEPT);
    history[userKey(userName)] = Object.fromEntries(kept.map((key) => [key, weeks[key]]));

    try {
        storage.setItem(FOR_YOU_HISTORY_KEY, JSON.stringify(history));
    } catch {
        // Storage full or blocked: next week just doesn't move these down.
    }
};
