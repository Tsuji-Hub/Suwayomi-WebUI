/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

type Waiter = { start: () => void };

/**
 * Token bucket: up to `burst` tasks start at once, then one per `spacingMs` (average rate 1 / spacingMs). Tasks start
 * in call order, every queued task is held while paused (e.g. after a 429), and a token is only spent when a task
 * reaches the front, so aborted tasks never use one.
 */
export class SpacedQueue {
    private readonly waiters: Waiter[] = [];

    private readonly burst: number;

    private readonly now: () => number;

    private tokens: number;

    private lastRefill: number;

    private pausedUntil = 0;

    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly spacingMs: number,
        { burst = 1, now = Date.now }: { burst?: number; now?: () => number } = {},
    ) {
        this.burst = burst;
        this.now = now;
        this.tokens = burst;
        this.lastRefill = now();
    }

    pauseUntil(epochMs: number): void {
        this.pausedUntil = Math.max(this.pausedUntil, epochMs);
    }

    async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted();

        await new Promise<void>((resolve, reject) => {
            const waiter: Waiter = { start: resolve };

            signal?.addEventListener(
                'abort',
                () => {
                    const index = this.waiters.indexOf(waiter);
                    if (index !== -1) {
                        this.waiters.splice(index, 1);
                        reject(signal.reason);
                    }
                },
                { once: true },
            );

            this.waiters.push(waiter);
            this.pump();
        });

        // Aborted between leaving the queue and starting (e.g. a React effect cleanup in the same tick):
        // give the token back and don't send anything.
        if (signal?.aborted) {
            this.refund();
            throw signal.reason;
        }

        return task();
    }

    private refund(): void {
        this.tokens = Math.min(this.burst, this.tokens + 1);

        // A waiter may already be sleeping for the next token: wake it now instead.
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.pump();
    }

    private refill(time: number): void {
        const elapsed = time - this.lastRefill;
        if (elapsed > 0) {
            this.tokens = Math.min(this.burst, this.tokens + elapsed / this.spacingMs);
            this.lastRefill = time;
        }
    }

    private schedule(waitMs: number): void {
        // Re-evaluated on wake-up: the pause may have been extended or the head waiter aborted.
        this.timer = setTimeout(
            () => {
                this.timer = null;
                this.pump();
            },
            Math.max(1, Math.ceil(waitMs)),
        );
    }

    private pump(): void {
        if (this.timer !== null || !this.waiters.length) {
            return;
        }

        const time = this.now();
        if (time < this.pausedUntil) {
            this.schedule(this.pausedUntil - time);
            return;
        }

        this.refill(time);
        // Tolerate float drift so a nearly full token doesn't cost another timer round.
        if (this.tokens < 1 - 1e-9) {
            this.schedule((1 - this.tokens) * this.spacingMs);
            return;
        }

        this.tokens = Math.max(0, this.tokens - 1);
        this.waiters.shift()!.start();
        this.pump();
    }
}
