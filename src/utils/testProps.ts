import { Platform } from 'react-native';

export const testProps = (id: string) => ({
    testID: id,
    accessibilityLabel: id,
    ...(Platform.OS === 'android' ? { accessible: true } : {}),
});
