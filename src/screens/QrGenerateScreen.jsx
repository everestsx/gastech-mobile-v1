import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system";

const BASE64 = (FileSystem.EncodingType && FileSystem.EncodingType.Base64) || "base64";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../context/ThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCustomers } from "../services/customer.service";

export default function QrGenerateScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [customers, setCustomers] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [isQrGenerated, setIsQrGenerated] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  const qrRef = useRef(null);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background, padding: 16 },
        header: { flexDirection: "row", alignItems: "center", marginTop: 8 },
        headerTitle: { fontSize: 22, fontWeight: "800", color: colors.primary, marginLeft: 12 },
        subtitle: {
          fontSize: 13,
          lineHeight: 20,
          color: colors.textSecondary,
          marginTop: 12,
          marginBottom: 14,
        },
        sectionCard: {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 16,
          padding: 14,
          marginBottom: 14,
        },
        sectionTitle: {
          fontSize: 15,
          fontWeight: "700",
          color: colors.text,
          marginBottom: 10,
        },
        input: {
          backgroundColor: colors.background,
          fontSize: 16,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: 12,
          color: colors.text,
          borderWidth: 1,
          borderColor: colors.border,
        },
        suggestionBox: { maxHeight: 220, marginTop: 10 },
        suggestionItem: {
          backgroundColor: colors.background,
          paddingVertical: 12,
          paddingHorizontal: 12,
          borderRadius: 12,
          marginBottom: 6,
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        suggestionText: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
        selectedBadge: {
          marginTop: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.primary + "55",
          backgroundColor: colors.primary + "12",
          paddingVertical: 10,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        selectedBadgeText: { flex: 1, fontSize: 14, color: colors.text, fontWeight: "600" },
        button: {
          backgroundColor: colors.primary,
          paddingVertical: 13,
          paddingHorizontal: 16,
          borderRadius: 12,
          alignItems: "center",
          marginTop: 2,
          flexDirection: "row",
          justifyContent: "center",
          gap: 8,
        },
        buttonDisabled: { backgroundColor: colors.textSecondary, opacity: 0.6 },
        buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
        qrWrapper: {
          marginTop: 4,
          alignItems: "center",
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 20,
          padding: 16,
        },
        qrBox: {
          backgroundColor: "#fff",
          padding: 16,
          borderRadius: 20,
          elevation: 4,
        },
        customerName: {
          marginTop: 12,
          fontSize: 18,
          fontWeight: "600",
          color: colors.text,
          textAlign: "center",
        },
        qrPlaceholder: {
          height: 240,
          width: 240,
          backgroundColor: colors.border,
          borderRadius: 20,
          justifyContent: "center",
          alignItems: "center",
        },
        placeholderText: { fontSize: 16, color: colors.textSecondary },
        helperText: {
          marginTop: 10,
          fontSize: 12,
          lineHeight: 18,
          color: colors.textSecondary,
          textAlign: "center",
        },
      }),
    [colors]
  );

  useEffect(() => {
    loadCustomers();
    checkPermission();
  }, []);

  const checkPermission = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    setHasPermission(status === "granted");
  };

  const loadCustomers = async () => {
    const data = await getCustomers();
    setCustomers(data || []);
  };

  const onSearch = (text) => {
    setSearch(text);
    setIsQrGenerated(false);
    setSelectedCustomer(null);

    if (!text) {
      setFiltered([]);
      return;
    }

    setFiltered(
      customers.filter((c) =>
        String(c?.name || "").toLowerCase().includes(text.toLowerCase())
      )
    );
  };

  const selectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setSearch(customer.name);
    setFiltered([]);
  };

  const generateQR = () => {
    if (!selectedCustomer) return;
    setIsQrGenerated(true);
  };

  const downloadQR = async () => {
    if (!qrRef.current) {
      Alert.alert("Error", "QR not ready");
      return;
    }

    if (!hasPermission) {
      Alert.alert("Permission required", "Gallery permission denied");
      return;
    }

    try {
      const dataUrl = await new Promise((resolve) =>
        qrRef.current.toDataURL((data) => resolve(data))
      );

      const fileUri = FileSystem.cacheDirectory + `customer_${selectedCustomer.id}.png`;

      await FileSystem.writeAsStringAsync(fileUri, dataUrl, {
        encoding: BASE64,
      });

      await MediaLibrary.saveToLibraryAsync(fileUri);

      Alert.alert("Success", "QR Code saved to gallery");
    } catch (err) {
      console.log(err);
      Alert.alert("Error", "Failed to save QR");
    }
  };

  const qrValue = selectedCustomer ? `CUSTOMER:${selectedCustomer.id}` : "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 8 : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 200 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={28} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Customer QR Generator</Text>
          </View>
          <Text style={styles.subtitle}>
            Search and select a customer, then generate a clean QR code for quick counter scanning.
          </Text>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>1) Choose Customer</Text>
            <TextInput
              style={styles.input}
              placeholder="Type customer name..."
              placeholderTextColor={colors.textSecondary}
              value={search}
              onChangeText={onSearch}
              returnKeyType="search"
              blurOnSubmit
              onSubmitEditing={() => Keyboard.dismiss()}
            />

            {filtered.length > 0 && (
              <FlatList
                data={filtered}
                keyExtractor={(item) => item.id.toString()}
                style={styles.suggestionBox}
                scrollEnabled={false}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.suggestionItem}
                    onPress={() => selectCustomer(item)}
                  >
                    <Text style={styles.suggestionText}>{item.name}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              />
            )}

            {selectedCustomer ? (
              <View style={styles.selectedBadge}>
                <Ionicons name="person-circle-outline" size={20} color={colors.primary} />
                <Text style={styles.selectedBadgeText}>{selectedCustomer.name}</Text>
                <Ionicons name="checkmark-circle" size={18} color={colors.success || "#16a34a"} />
              </View>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.button, !selectedCustomer && styles.buttonDisabled]}
            disabled={!selectedCustomer}
            onPress={generateQR}
          >
            <Ionicons name="qr-code-outline" size={20} color="#fff" />
            <Text style={styles.buttonText}>Generate QR</Text>
          </TouchableOpacity>

          <View style={styles.qrWrapper}>
            {isQrGenerated && selectedCustomer ? (
              <>
                <View style={styles.qrBox}>
                  <QRCode value={qrValue} size={220} ref={qrRef} />
                </View>
                <Text style={styles.customerName}>{selectedCustomer.name}</Text>

                <TouchableOpacity style={styles.button} onPress={downloadQR}>
                  <Ionicons name="download-outline" size={20} color="#fff" />
                  <Text style={styles.buttonText}>Download QR</Text>
                </TouchableOpacity>
                <Text style={styles.helperText}>Saved as PNG in your gallery for printing or sharing.</Text>
              </>
            ) : (
              <>
                <View style={styles.qrPlaceholder}>
                  <Ionicons name="qr-code-outline" size={44} color={colors.textSecondary} />
                </View>
                <Text style={styles.helperText}>
                  QR preview appears here after selecting a customer and tapping Generate.
                </Text>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
