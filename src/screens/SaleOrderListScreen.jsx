import { useEffect, useState, useCallback } from "react";
import {
  StatusBar,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getAllSaleOrders } from "../services/saleOrder.service";
import { getCachedOrders } from "../services/sync.service";

export default function SaleOrderListScreen({ route, navigation }) {
  const customerId = route?.params?.customerId ?? null;
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    try {
      const data = await getCachedOrders();
      let list = Array.isArray(data) ? data : [];
      if (customerId != null) {
        list = list.filter((o) => o.partner_id?.[0] === customerId);
      }
      setOrders(list);
    } catch (_) {
      try {
        const data = await getAllSaleOrders();
        let list = data || [];
        if (customerId != null) {
          list = list.filter((o) => o.partner_id?.[0] === customerId);
        }
        setOrders(list);
      } catch (err) {
        console.error("Sale Order Error:", err);
        setOrders([]);
      }
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const openDetails = (order) => {
    navigation.navigate("SaleOrderDetails", {
      saleOrderId: order.id,
    });
  };

  const getStatusStyle = (state) => {
    switch (state) {
      case "sale":
        return styles.sale;
      case "draft":
        return styles.draft;
      case "cancel":
        return styles.cancel;
      default:
        return styles.defaultStatus;
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1e5aa8" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ---------------- HEADER ---------------- */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (customerId != null) navigation.navigate('Orders', { customerId: null });
            else navigation.goBack();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color="#1e5aa8" />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>
          {customerId != null ? "Orders (Customer)" : "Sale Orders"}
        </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate("ScanQRCode")}
          style={styles.qrBtnHeader}
        >
          <Ionicons name="qr-code-outline" size={28} color="#1e5aa8" />
        </TouchableOpacity>
      </View>

      {/* ---------------- SALE ORDER LIST ---------------- */}
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ paddingBottom: 140 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => openDetails(item)}
            activeOpacity={0.8}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.orderNo}>{item.name}</Text>
              <View style={[styles.statusBadge, getStatusStyle(item.state)]}>
                <Text style={styles.statusText}>{item.state.toUpperCase()}</Text>
              </View>
            </View>

            <Text style={styles.customer}>{item.partner_id?.[1] || "—"}</Text>

            <View style={styles.rowBetween}>
              <Text style={styles.date}>{item.date_order}</Text>
              <Text style={styles.amount}>Rs. {item.amount_total}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f6f8",
    paddingHorizontal: 15,
    paddingTop: 10,
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  /* ---------------- HEADER ---------------- */
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    justifyContent: "space-between",
  },

  backBtn: {
    padding: 4,
  },

  screenTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1e5aa8",
    textAlign: "center",
    flex: 1,
  },

  qrBtnHeader: {
    padding: 4,
  },

  /* ---------------- CARD ---------------- */
  card: {
    backgroundColor: "#ffffff",
    padding: 18,
    borderRadius: 16,
    marginBottom: 12,
    elevation: 4,
  },

  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  orderNo: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111",
  },

  customer: {
    fontSize: 15,
    color: "#555",
    marginVertical: 6,
  },

  date: {
    fontSize: 13,
    color: "#999",
  },

  amount: {
    fontSize: 16,
    fontWeight: "800",
    color: "#1e5aa8",
  },

  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },

  statusText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },

  sale: { backgroundColor: "#34a853" },
  draft: { backgroundColor: "#fbbc05" },
  cancel: { backgroundColor: "#ea4335" },
  defaultStatus: { backgroundColor: "#999" },
});
