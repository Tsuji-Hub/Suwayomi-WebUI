/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { loadable } from 'react-lazily/loadable';
import type { SimilarManga } from '@/features/tsuji/similar/useSimilarRecs.ts';

// Lazy so the manga page chunk only grows by this wrapper; recs code loads with the section.
const { SimilarSection } = loadable(() => import('@/features/tsuji/similar/SimilarSection.tsx'));
const { TsujiRawChips } = loadable(() => import('@/features/tsuji/raws/components/RawChips.tsx'));

/** Hook point on the series page (MangaDetails): raws / MTL row (brief #6), then Similar. */
export const TsujiSimilarSection = ({ manga }: { manga: SimilarManga }) => (
    <>
        <TsujiRawChips manga={manga} />
        <SimilarSection manga={manga} />
    </>
);
