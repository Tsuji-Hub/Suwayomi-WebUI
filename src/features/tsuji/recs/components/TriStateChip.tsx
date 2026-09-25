/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import Chip from '@mui/material/Chip';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import type { TagFilterState } from '@/features/tsuji/recs/filters.ts';

export type TriState = TagFilterState | undefined;

/** off -> include (green) -> exclude (red) -> off */
export const nextTriState = (state: TriState): TriState => {
    if (state === undefined) {
        return 'include';
    }

    return state === 'include' ? 'exclude' : undefined;
};

export const setTriState = (
    states: Record<string, TagFilterState>,
    name: string,
    state: TriState,
): Record<string, TagFilterState> => {
    const { [name]: _removed, ...rest } = states;
    return state ? { ...rest, [name]: state } : rest;
};

const STATE_PROPS = {
    include: { color: 'success', variant: 'filled', icon: <AddIcon /> },
    exclude: { color: 'error', variant: 'filled', icon: <RemoveIcon /> },
    off: { color: 'default', variant: 'outlined', icon: undefined },
} as const;

export const TriStateChip = ({
    label,
    state,
    onChange,
}: {
    label: string;
    state: TriState;
    onChange: (state: TriState) => void;
}) => {
    const { color, variant, icon } = STATE_PROPS[state ?? 'off'];

    return (
        <Chip
            size="small"
            label={label}
            color={color}
            variant={variant}
            icon={icon}
            onClick={() => onChange(nextTriState(state))}
            aria-pressed={state !== undefined}
            sx={{ transition: 'background-color 150ms ease, border-color 150ms ease, color 150ms ease' }}
        />
    );
};
