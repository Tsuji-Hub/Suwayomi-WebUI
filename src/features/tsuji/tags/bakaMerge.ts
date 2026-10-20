/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { BakaSeries } from '@/features/tsuji/tags/baka.ts';

export type BakaPage = { series: BakaSeries[]; hasNextPage: boolean };

type Source = { page: number; buffer: BakaSeries[]; hasMore: boolean };

/**
 * Several MangaBaka sub-searches (one per tag combination, brief #11) read as one list: a k-way merge in the
 * searches' own order, de-duplicated by MangaBaka id. Each sub-search keeps a cursor and fetches its next page only
 * when its buffered rows run out, so nothing is skipped or repeated and one search costs one request per page.
 * A failed `next` consumes nothing (fetched pages stay buffered), so it can simply be called again.
 */
export const createBakaMerge = ({
    sourceCount,
    fetchPage,
    compare,
}: {
    sourceCount: number;
    /** Page `page` (from 1) of sub-search `source`. */
    fetchPage: (source: number, page: number) => Promise<BakaPage>;
    compare: (a: BakaSeries, b: BakaSeries) => number;
}) => {
    const sources: Source[] = Array.from({ length: sourceCount }, () => ({ page: 0, buffer: [], hasMore: true }));
    const emitted = new Set<number>();

    const refill = async () => {
        const empty = sources
            .map((source, index) => ({ source, index }))
            .filter(({ source }) => !source.buffer.length && source.hasMore);
        const pages = await Promise.all(empty.map(({ source, index }) => fetchPage(index, source.page + 1)));
        empty.forEach(({ index }, position) => {
            const { series, hasNextPage } = pages[position];
            const source = sources[index];
            source.page += 1;
            source.buffer.push(...series);
            source.hasMore = hasNextPage && series.length > 0;
        });
    };

    const hasNext = () => sources.some(({ buffer, hasMore }) => buffer.length > 0 || hasMore);

    /** The next `count` series of the merged list (fewer at the end); on failure nothing is consumed. */
    const next = async (count: number): Promise<BakaSeries[]> => {
        const batch: BakaSeries[] = [];
        const taken: { source: Source; series: BakaSeries; isNew: boolean }[] = [];
        try {
            while (batch.length < count) {
                if (sources.some(({ buffer, hasMore }) => !buffer.length && hasMore)) {
                    // oxlint-disable-next-line no-await-in-loop
                    await refill();
                }
                const heads = sources.filter(({ buffer }) => buffer.length);
                if (!heads.length) {
                    break;
                }
                const best = heads.reduce((winner, source) =>
                    compare(source.buffer[0], winner.buffer[0]) < 0 ? source : winner,
                );
                const series = best.buffer.shift()!;
                const isNew = !emitted.has(series.id);
                taken.push({ source: best, series, isNew });
                if (isNew) {
                    emitted.add(series.id);
                    batch.push(series);
                }
            }
        } catch (error) {
            // Put back what this call took (pages already fetched stay buffered).
            taken.reverse().forEach(({ source, series, isNew }) => {
                source.buffer.unshift(series);
                if (isNew) {
                    emitted.delete(series.id);
                }
            });
            throw error;
        }
        return batch;
    };

    return { next, hasNext };
};
