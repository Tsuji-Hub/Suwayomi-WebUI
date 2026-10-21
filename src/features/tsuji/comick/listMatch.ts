/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import type { ListTitleIndex } from '@/features/tsuji/seen/myList.ts';
import { titleKey } from '@/features/tsuji/seen/myList.ts';

/** The AniList id of a list title the card's titles match, if any. */
export const matchListTitle = (media: Pick<RecMedia, 'title'>, index: ListTitleIndex): number | null => {
    const names = [media.title?.english, media.title?.userPreferred, media.title?.romaji];
    for (const name of names) {
        const key = titleKey(name);
        if (key && index[key] !== undefined) {
            return index[key];
        }
    }
    return null;
};

/**
 * Comick cards without an AniList id take the id of the list title they match (brief #15): list state, read marks,
 * badges and the hide rules then work on them as on any AniList card. Others are left as they are.
 */
export const adoptListIds = <T extends RecMedia>(cards: T[], index: ListTitleIndex | null): T[] =>
    index
        ? cards.map((card) => {
              if (card.id >= 0) {
                  return card;
              }
              const id = matchListTitle(card, index);
              return id === null ? card : { ...card, id };
          })
        : cards;
