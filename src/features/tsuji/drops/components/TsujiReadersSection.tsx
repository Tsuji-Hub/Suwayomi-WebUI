/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { loadable } from 'react-lazily/loadable';
import type { GqlMetaHolder } from '@/features/metadata/Metadata.types.ts';

// Lazy: the series page chunk only grows by this wrapper.
const { ReadersBlock } = loadable(() => import('@/features/tsuji/drops/components/ReadersBlock.tsx'));

/** Hook point on the series page (MangaDetails), under the buttons: the drop rate and drop map (brief #20). */
export const TsujiReadersSection = ({ manga }: { manga: { id: number } & GqlMetaHolder }) => (
    <ReadersBlock manga={manga} />
);
