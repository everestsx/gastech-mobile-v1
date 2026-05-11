import fs from 'fs';
import path from 'path';
import { browser } from '@wdio/globals';

const apkPath = path.resolve(
    __dirname,
    '..',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    'debug',
    'app-debug.apk'
);

const ensureApkExists = () => {
    if (!fs.existsSync(apkPath)) {
        throw new Error(
            `APK not found at ${apkPath}. Build it first: cd android && .\\gradlew.bat assembleDebug`
        );
    }
};

const buildScreenshotPath = (title: string) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTitle = title.replace(/[^a-z0-9-_]+/gi, '_');
    return path.join(process.cwd(), 'e2e', 'artifacts', `FAILED_${safeTitle}_${stamp}.png`);
};

export const config: WebdriverIO.Config = {
    runner: 'local',
    port: 4723,
    specs: [path.join(__dirname, 'specs', '**', '*.spec.ts')],
    maxInstances: 1,
    logLevel: 'info',
    waitforTimeout: 10000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,

    capabilities: [
        {
            platformName: 'Android',
            'appium:automationName': 'UiAutomator2',
            'appium:deviceName': 'Medium_Phone',
            'appium:avd': 'Medium_Phone',
            'appium:platformVersion': '16',
            'appium:app': apkPath,
            'appium:appActivity': 'expo.modules.devlauncher.launcher.DevLauncherActivity',
            'appium:appWaitActivity': 'com.gastech.mobile.*',
            'appium:appWaitDuration': 60000,
            'appium:noReset': false,
            'appium:fullReset': false,
            'appium:newCommandTimeout': 120,
            'appium:autoGrantPermissions': true,
        },
    ],

    framework: 'mocha',
    mochaOpts: {
        timeout: 120000,
    },

    services: [
        [
            'appium',
            {
                args: {
                    relaxedSecurity: true,
                },
            },
        ],
    ],

    reporters: ['spec'],

    autoCompileOpts: {
        autoCompile: true,
        tsNodeOpts: {
            transpileOnly: true,
            project: path.resolve(__dirname, 'tsconfig.json'),
        },
    },

    beforeSession: () => {
        ensureApkExists();
    },

    afterTest: async (test, _context, result) => {
        if (result.error) {
            const screenshotPath = buildScreenshotPath(test.title);
            await browser.saveScreenshot(screenshotPath);
        }
    },
};
