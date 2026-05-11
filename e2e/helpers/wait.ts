import { $, browser } from '@wdio/globals';

export const waitForVisible = async (selector: string, timeoutMs = 10000) => {
    const el = await $(selector);
    await el.waitForDisplayed({ timeout: timeoutMs });
    return el;
};

export const waitForHidden = async (selector: string, timeoutMs = 10000) => {
    const el = await $(selector);
    await el.waitForDisplayed({ timeout: timeoutMs, reverse: true });
};

export const pause = async (ms: number) => {
    await browser.pause(ms);
};
