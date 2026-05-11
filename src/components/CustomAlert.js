import React from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Dimensions,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, borderRadius, colors } from '../constants/theme';

const { width } = Dimensions.get('window');

export default function CustomAlert({
    visible,
    title,
    message,
    onClose,
    testID,
    accessibilityLabel,
    buttons = [], // Array of { text, onPress, style: 'cancel' | 'default' | 'destructive' }
}) {
    const { colors } = useTheme();

    if (!visible) return null;

    return (
        <Modal transparent visible={visible} animationType="fade">
            <View style={styles.overlay}>
                <View
                    style={[styles.alertBox, { backgroundColor: colors.surface }]}
                    testID={testID}
                    accessibilityLabel={accessibilityLabel || testID}
                >
                    <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
                    <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>

                    <View style={styles.buttonContainer}>
                        {buttons.length > 0 ? (
                            buttons.map((btn, index) => (
                                <TouchableOpacity
                                    key={index}
                                    style={[
                                        styles.button,
                                        btn.style === 'destructive' ? { backgroundColor: colors.error || '#ef4444' } :
                                            btn.style === 'cancel' ? { backgroundColor: colors.border } :
                                                { backgroundColor: colors.primary }
                                    ]}
                                    onPress={btn.onPress}
                                >
                                    <Text style={[
                                        styles.buttonText,
                                        btn.style === 'cancel' ? { color: colors.white } : { color: '#fff' }
                                    ]}>
                                        {btn.text}
                                    </Text>
                                </TouchableOpacity>
                            ))
                        ) : (
                            <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={onClose}>
                                <Text style={styles.buttonText}>OK</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    alertBox: {
        width: width * 0.85,
        borderRadius: borderRadius.lg,
        padding: spacing.lg,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
    },
    title: {
        fontSize: 20,
        fontWeight: '800',
        marginBottom: spacing.sm,
        textAlign: 'center',
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: spacing.lg,
        lineHeight: 22,
    },
    buttonContainer: {
        flexDirection: 'row',
        gap: spacing.sm,
        justifyContent: 'center',
    },
    button: {
        flex: 1,
        height: 48,
        borderRadius: borderRadius.md,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#fff'
    },
});