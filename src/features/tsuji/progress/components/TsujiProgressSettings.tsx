/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useLingui } from '@lingui/react/macro';
import { CheckboxInput } from '@/base/components/inputs/CheckboxInput.tsx';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { setTsujiGlobalMeta, useTsujiFlag } from '@/features/tsuji/services/TsujiMetadata.ts';

/** Library options > Display > Badges. */
export const TsujiLibraryProgressSetting = () => {
    const { t } = useLingui();
    const isEnabled = useTsujiFlag(TSUJI_META_KEYS.libraryProgressBadge);

    return (
        <CheckboxInput
            label={t`Series progress badges`}
            checked={isEnabled}
            onChange={() => setTsujiGlobalMeta(TSUJI_META_KEYS.libraryProgressBadge, String(!isEnabled))}
        />
    );
};

/** Reader settings > General (also shown in Settings > Reader). */
export const TsujiReaderProgressSetting = () => {
    const { t } = useLingui();
    const isEnabled = useTsujiFlag(TSUJI_META_KEYS.readerChapterProgress);

    return (
        <CheckboxInput
            label={t`Show series progress`}
            checked={isEnabled}
            onChange={(_, checked) => setTsujiGlobalMeta(TSUJI_META_KEYS.readerChapterProgress, String(checked))}
        />
    );
};
