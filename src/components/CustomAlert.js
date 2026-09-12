import React from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import {spacing, borderRadius} from '../constants/theme';

const { width } = Dimensions.get('window');

export default function CustomAlert({
                                        visible,
                                        title,
                                        message,
                                        onClose,
                                        type = 'default', // 'default' | 'success' | 'error' | 'warning'
                                        buttons = [], // Array of { text, onPress, style: 'cancel' | 'default' | 'destructive' }
                                    }) {
    const { colors } = useTheme();

    if (!visible) return null;

    const accent =
        type === 'success' ? (colors.success || '#22c55e') :
        type === 'error' ? (colors.error || '#ef4444') :
        type === 'warning' ? (colors.warning || '#d97706') :
        colors.primary;
    const iconName =
        type === 'success' ? 'checkmark-circle' :
        type === 'error' ? 'alert-circle' :
        type === 'warning' ? 'warning' :
        'information-circle';
    const showTypeChrome = type === 'success' || type === 'error' || type === 'warning';

    const buttonColor = (btn) => {
        if (btn.style === 'destructive') return colors.error || '#ef4444';
        if (btn.style === 'cancel') return colors.border;
        if (showTypeChrome) return accent;
        return colors.primary;
    };

    return (
        <Modal transparent visible={visible} animationType="fade">
            <View style={styles.overlay}>
                <View style={[styles.alertBox, { backgroundColor: colors.surface }]}>
                    {showTypeChrome ? (
                        <View style={[styles.typeBar, { backgroundColor: accent }]} />
                    ) : null}
                    {showTypeChrome ? (
                        <View style={[styles.iconWrap, { backgroundColor: `${accent}1A` }]}>
                            <Ionicons name={iconName} size={28} color={accent} />
                        </View>
                    ) : null}
                    <Text style={[styles.title, { color: showTypeChrome ? accent : colors.text }]}>{title}</Text>
                    <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>

                    <View style={styles.buttonContainer}>
                        {buttons.length > 0 ? (
                            buttons.map((btn, index) => (
                                <TouchableOpacity
                                    key={index}
                                    style={[
                                        styles.button,
                                        { backgroundColor: buttonColor(btn) },
                                    ]}
                                    onPress={btn.onPress}
                                    activeOpacity={0.75}
                                >
                                    <Text style={[
                                        styles.buttonText,
                                        btn.style === 'cancel' ? { color: colors.white || colors.text } : { color: '#fff' }
                                    ]}>
                                        {btn.text}
                                    </Text>
                                </TouchableOpacity>
                            ))
                        ) : (
                            <TouchableOpacity
                                style={[styles.button, { backgroundColor: showTypeChrome ? accent : colors.primary }]}
                                onPress={onClose}
                                activeOpacity={0.75}
                            >
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
        overflow: 'hidden',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
    },
    typeBar: {
        height: 5,
        marginHorizontal: -spacing.lg,
        marginTop: -spacing.lg,
        marginBottom: spacing.md,
    },
    iconWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        marginBottom: spacing.sm,
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
        color : '#fff'
    },
});
