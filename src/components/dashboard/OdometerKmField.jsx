import React, { useMemo } from 'react';
import { View, Text, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { createCheckSheetStyles } from './checkSheetStyles';

export default function OdometerKmField({
  caption,
  hint,
  value,
  onChangeText,
  placeholder,
  errorText,
  editable = true,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createCheckSheetStyles(colors), [colors]);

  return (
    <View style={styles.odometerBlock}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <Ionicons name="speedometer-outline" size={18} color={colors.warning ?? '#f59e0b'} />
        <Text style={[styles.odometerCaption, { marginBottom: 0, flex: 1 }]}>
          {caption}
          <Text style={{ color: '#dc2626' }}> *</Text>
        </Text>
      </View>
      {hint ? <Text style={styles.odometerHint}>{hint}</Text> : null}
      <View
        style={[
          styles.odometerInputWrap,
          errorText ? { borderColor: '#dc2626' } : null,
        ]}
      >
        <TextInput
          style={styles.odometerInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType="decimal-pad"
          inputMode="decimal"
          selectTextOnFocus
          editable={editable}
        />
      </View>
      {errorText ? <Text style={styles.odometerError}>{errorText}</Text> : null}
    </View>
  );
}
