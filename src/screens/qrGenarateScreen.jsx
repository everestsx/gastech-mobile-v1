import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";

import { getCustomers } from "../services/customer.service";

export default function QrGenerateScreen({ navigation }) {
  const [customers, setCustomers] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [isQrGenerated, setIsQrGenerated] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  const qrRef = useRef(null);

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
        c.name.toLowerCase().includes(text.toLowerCase())
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
        encoding: FileSystem.EncodingType.Base64,
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
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      
      {/* ---------------- HEADER ---------------- */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={28} color="#1a73e8" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>QR Generator</Text>
      </View>

      {/* ---------------- SEARCH ---------------- */}
      <TextInput
        style={styles.input}
        placeholder="Search customer..."
        placeholderTextColor="#999"
        value={search}
        onChangeText={onSearch}
      />

      {filtered.length > 0 && (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id.toString()}
          style={styles.suggestionBox}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.suggestionItem}
              onPress={() => selectCustomer(item)}
            >
              <Text style={styles.suggestionText}>{item.name}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* ---------------- GENERATE BUTTON ---------------- */}
      <TouchableOpacity
        style={[styles.button, !selectedCustomer && styles.buttonDisabled]}
        disabled={!selectedCustomer}
        onPress={generateQR}
      >
        <Text style={styles.buttonText}>Generate QR</Text>
      </TouchableOpacity>

      {/* ---------------- GENERATED QR ---------------- */}
      <View style={styles.qrWrapper}>
        {isQrGenerated && selectedCustomer ? (
          <>
            <View style={styles.qrBox}>
              <QRCode value={qrValue} size={220} ref={qrRef} />
            </View>
            <Text style={styles.customerName}>{selectedCustomer.name}</Text>

            <TouchableOpacity style={styles.button} onPress={downloadQR}>
              <Text style={styles.buttonText}>Download QR</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.qrPlaceholder}>
            <Text style={styles.placeholderText}>QR Code Preview</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f6f8",
    padding: 16,
    
  },

  /* HEADER */
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginTop:20
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a73e8",
    marginLeft: 12,
  },

  /* SEARCH */
  input: {
    backgroundColor: "#fff",
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    color: "#111",
    marginBottom: 10,
  },
  suggestionBox: {
    maxHeight: 160,
    marginBottom: 10,
  },
  suggestionItem: {
    backgroundColor: "#1a73e8",
    padding: 12,
    borderRadius: 10,
    marginBottom: 6,
  },
  suggestionText: {
    color: "#fff",
    fontSize: 16,
  },

  /* BUTTONS */
  button: {
    backgroundColor: "#1a73e8",
    paddingVertical: 14,
    paddingHorizontal:16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 12,
  },
  buttonDisabled: {
    backgroundColor: "gray",
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },

  /* QR */
  qrWrapper: {
    marginTop: 30,
    alignItems: "center",
  },
  qrBox: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 20,
    elevation: 4,
  },
  customerName: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: "600",
    color: "#111",
    textAlign: "center",
  },
  qrPlaceholder: {
    height: 240,
    width: 240,
    backgroundColor: "#e0e0e0",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    fontSize: 16,
    color: "#555",
  },
});
