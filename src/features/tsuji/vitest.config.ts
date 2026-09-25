/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests cover the framework-free fork modules only, so no React/Lingui plugins are needed here.
export default defineConfig({
    resolve: { alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) } },
    test: { include: ['src/features/tsuji/**/*.test.ts'], environment: 'node' },
});
