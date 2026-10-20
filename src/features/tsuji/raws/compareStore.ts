/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { create } from 'zustand';

/** Compare (English left, raw right) is on for this reader session only. */
export const useCompareStore = create<{ isActive: boolean }>(() => ({ isActive: false }));

export const setCompareActive = (isActive: boolean) => useCompareStore.setState({ isActive });
