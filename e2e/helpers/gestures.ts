import { browser } from '@wdio/globals';

export const swipeUp = async (distanceRatio = 0.6) => {
    const { height, width } = await browser.getWindowSize();
    const startX = Math.round(width / 2);
    const startY = Math.round(height * 0.8);
    const endY = Math.round(height * (1 - distanceRatio));

    await browser.performActions([
        {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
                { type: 'pointerMove', duration: 0, x: startX, y: startY },
                { type: 'pointerDown', button: 0 },
                { type: 'pause', duration: 200 },
                { type: 'pointerMove', duration: 700, x: startX, y: endY },
                { type: 'pointerUp', button: 0 },
            ],
        },
    ]);
};
