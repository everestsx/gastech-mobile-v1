import fs from 'fs';
import path from 'path';
import { browser } from '@wdio/globals';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });
dotenv.config();

const apkPath = path.resolve(
    __dirname,
    '..',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    'release',
    'app-release.apk'
);

const ensureApkExists = () => {
    if (!fs.existsSync(apkPath)) {
        throw new Error(
            `APK not found at ${apkPath}.\nBuild it first:\n  cd android && .\\gradlew.bat assembleRelease`
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
    waitforTimeout: 20000,
    onPrepare: () => {
        const artifactsDir = path.join(process.cwd(), 'e2e', 'artifacts');
        if (!fs.existsSync(artifactsDir)) {
            fs.mkdirSync(artifactsDir, { recursive: true });
        }
    },
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
            // Use the real main activity — NOT DevLauncherActivity (debug-only, crashes on Appium restart)
            'appium:appActivity': 'com.gastech.mobile.MainActivity',
            'appium:appWaitActivity': 'com.gastech.mobile.MainActivity',
            'appium:appWaitDuration': 30000,
            'appium:noReset': false,          // Clear app data before each test session so it always starts at login
            'appium:dontStopAppOnReset': false,
            'appium:fullReset': false,
            'appium:newCommandTimeout': 300,
            'appium:autoGrantPermissions': true,
            'appium:adbExecTimeout': 90000,   // Give adb more time on slow emulators
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
