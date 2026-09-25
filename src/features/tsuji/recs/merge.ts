/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecCandidate, RecMedia, RecSourceId } from '@/features/tsuji/recs/Recs.types.ts';

export type RecEdge = { rating: number | null; media: RecMedia | null };

/** Union of AniList edges, tag recall and MAL-mapped recs, deduped by AniList id, seed dropped. */
export const mergeCandidates = ({
    seedId,
    edges,
    recall,
    malMapped,
}: {
    seedId: number;
    edges: RecEdge[];
    recall: RecMedia[];
    malMapped: RecMedia[];
}): RecCandidate[] => {
    const byId = new Map<number, RecCandidate>();

    const add = (media: RecMedia | null, source: RecSourceId, edgeRating: number) => {
        if (!media || media.id === seedId) {
            return;
        }

        const existing = byId.get(media.id);
        if (!existing) {
            byId.set(media.id, { ...media, edgeRating, sources: [source] });
            return;
        }

        byId.set(media.id, {
            ...existing,
            edgeRating: Math.max(existing.edgeRating, edgeRating),
            sources: existing.sources.includes(source) ? existing.sources : [...existing.sources, source],
        });
    };

    edges.forEach(({ rating, media }) => add(media, 'anilist', rating ?? 0));
    recall.forEach((media) => add(media, 'tags', 0));
    malMapped.forEach((media) => add(media, 'mal', 0));

    return [...byId.values()];
};
