/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import AlignHorizontalCenterIcon from '@mui/icons-material/AlignHorizontalCenter';
import AlignHorizontalLeftIcon from '@mui/icons-material/AlignHorizontalLeft';
import AlignHorizontalRightIcon from '@mui/icons-material/AlignHorizontalRight';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { ValueToDisplayData } from '@/base/Base.types.ts';
import { CustomTooltip } from '@/base/components/CustomTooltip.tsx';
import { ButtonSelectInput } from '@/base/components/inputs/ButtonSelectInput.tsx';
import { SliderInput } from '@/base/components/inputs/SliderInput.tsx';
import type { PagePosition } from '@/features/tsuji/reader/position/pagePosition.ts';
import { PAGE_EDGE_OFFSET_MAX, PAGE_POSITIONS } from '@/features/tsuji/reader/position/pagePosition.ts';
import { usePagePosition } from '@/features/tsuji/reader/position/usePagePosition.ts';

const TITLES = { LEFT: msg`Left`, CENTER: msg`Center`, RIGHT: msg`Right` };

const VALUE_TO_DISPLAY_DATA: ValueToDisplayData<PagePosition> = {
    LEFT: { title: TITLES.LEFT, icon: <AlignHorizontalLeftIcon /> },
    CENTER: { title: TITLES.CENTER, icon: <AlignHorizontalCenterIcon /> },
    RIGHT: { title: TITLES.RIGHT, icon: <AlignHorizontalRightIcon /> },
};

/**
 * Reader settings > Layout: page position and the gap from that edge. Per device preset (like the reader width),
 * same page size in every position.
 */
export const TsujiPagePositionSetting = ({ setTransparent }: { setTransparent?: (transparent: boolean) => void }) => {
    const { t } = useLingui();
    const { position, offset, setPosition, setOffset } = usePagePosition();
    const [draftOffset, setDraftOffset] = useState(offset);

    useEffect(() => setDraftOffset(offset), [offset]);

    return (
        <Stack sx={{ gap: 1 }}>
            <ButtonSelectInput
                label={t`Page position`}
                description={t`Where the pages sit in the window. Their size doesn't change. Shift+L cycles it.`}
                value={position}
                values={PAGE_POSITIONS}
                setValue={setPosition}
                valueToDisplayData={VALUE_TO_DISPLAY_DATA}
            />
            {position !== 'CENTER' && (
                <SliderInput
                    label={t`Gap from the edge`}
                    value={`${draftOffset} px`}
                    slotProps={{
                        slider: {
                            'aria-label': t`Gap from the edge`,
                            value: draftOffset,
                            step: 10,
                            min: 0,
                            max: PAGE_EDGE_OFFSET_MAX,
                            onChange: (_, value) => {
                                setTransparent?.(true);
                                setDraftOffset(value as number);
                            },
                            onChangeCommitted: (_, value) => {
                                setTransparent?.(false);
                                setOffset(value as number);
                            },
                        },
                    }}
                />
            )}
        </Stack>
    );
};

/** Compact Left / Center / Right for the desktop reader menu's quick settings. */
export const TsujiPagePositionQuickSetting = () => {
    const { t } = useLingui();
    const { position, setPosition } = usePagePosition();

    return (
        <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={position}
            aria-label={t`Page position`}
            onChange={(_, value: PagePosition | null) => value && setPosition(value)}
        >
            {PAGE_POSITIONS.map((value) => (
                <CustomTooltip key={value} title={t(TITLES[value])}>
                    <ToggleButton value={value} aria-label={t(TITLES[value])}>
                        {VALUE_TO_DISPLAY_DATA[value].icon}
                    </ToggleButton>
                </CustomTooltip>
            ))}
        </ToggleButtonGroup>
    );
};
