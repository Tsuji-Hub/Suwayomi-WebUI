/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { getAllTitles } from '@/features/tsuji/recs/media.ts';
import { normalizeTitle } from '@/features/tsuji/recs/normalize.ts';
import type { ListTitleIndex } from '@/features/tsuji/seen/myList.ts';
import type { ComickRecommendation } from '@/features/tsuji/comick/comickCatalog.ts';
import { adoptListIds } from '@/features/tsuji/comick/listMatch.ts';

const titleKeys = (media: Pick<RecMedia, 'title'>) =>
    getAllTitles(media)
        .map(normalizeTitle)
        .filter((key) => key !== '');

/**
 * Comick's recommendations that the other sources don't already have (brief #15), by votes: each title once, matched
 * by AniList id (list titles lend theirs), then by normalized title, and never the series itself.
 */
export const getComickExtras = (
    recommendations: ComickRecommendation[],
    { shown, seedId, index }: { shown: Pick<RecMedia, 'id' | 'title'>[]; seedId: number; index: ListTitleIndex | null },
): RecMedia[] => {
    const ids = new Set([seedId, ...shown.map(({ id }) => id)]);
    const titles = new Set(shown.flatMap(titleKeys));
    const cards = adoptListIds(
        [...recommendations].sort((a, b) => b.votes - a.votes).map(({ media }) => media),
        index,
    );
    return cards.filter((media) => {
        const keys = titleKeys(media);
        if (ids.has(media.id) || keys.some((key) => titles.has(key))) {
            return false;
        }
        ids.add(media.id);
        keys.forEach((key) => titles.add(key));
        return true;
    });
};
