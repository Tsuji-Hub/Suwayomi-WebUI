/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { msg } from '@lingui/core/macro';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import { AppRoutes } from '@/base/AppRoute.constants.ts';
import type { NavbarItem } from '@/features/navigation-bar/NavigationBar.types.ts';
import { NavBarItemMoreGroup } from '@/features/navigation-bar/NavigationBar.types.ts';

/** Desktop sidebar entry; on mobile it lands under "More" (no sixth bottom-bar slot). */
export const TSUJI_DISCOVER_NAV_ITEM = {
    path: AppRoutes.discover.path,
    title: msg`Discover`,
    SelectedIconComponent: AutoAwesomeIcon,
    IconComponent: AutoAwesomeOutlinedIcon,
    show: 'desktop',
    moreGroup: NavBarItemMoreGroup.GENERAL,
} as const satisfies NavbarItem;
