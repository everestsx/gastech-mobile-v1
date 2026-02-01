import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getSaleOrderDetails,
  updateSaleOrderLineQty,
} from "../services/saleOrderLine.service";

export default function SaleOrderDetailsScreen({ route, navigation }) {
  const { saleOrderId } = route.params;

  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [qtyChanged, setQtyChanged] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDetails();
  }, []);

  /* ---------------- LOAD ORDER ---------------- */
  const loadDetails = async () => {
    setLoading(true);
    const data = await getSaleOrderDetails(saleOrderId);

    setOrder(data.order);
    setLines(
      data.lines.map((l) => ({
        ...l,
        newQty: l.product_uom_qty, // local editable qty
      }))
    );
    setQtyChanged(false);
    setLoading(false);
  };

  /* ---------------- QTY HANDLERS ---------------- */
  const changeQty = (lineId, delta) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id === lineId) {
          const nextQty = Math.max(0, Number(l.newQty) + delta);
          return { ...l, newQty: nextQty };
        }
        return l;
      })
    );
    setQtyChanged(true);
  };

  /* ---------------- UPDATE QTY API ---------------- */
  const updateQty = async () => {
    try {
      setLoading(true);

      for (let l of lines) {
        if (Number(l.newQty) !== l.product_uom_qty) {
          await updateSaleOrderLineQty(l.id, Number(l.newQty));
        }
      }

      Alert.alert("Success", "Quantities updated");
      await loadDetails();
    } catch (e) {
      Alert.alert("Error", "Failed to update quantity");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- RENDER LINE ---------------- */
  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.product}>{item.product_id[1]}</Text>

      <View style={styles.qtyRow}>
        <TouchableOpacity
          style={styles.qtyBtn}
          onPress={() => changeQty(item.id, -1)}
        >
          <Ionicons name="remove" size={20} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.qtyValue}>{item.newQty}</Text>

        <TouchableOpacity
          style={styles.qtyBtn}
          onPress={() => changeQty(item.id, 1)}
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <Text style={styles.price}>LKR {Number(item.price_total).toFixed(2)}</Text>
    </View>
  );

  if (!order) return null;

  return (
    <View style={styles.container}>
      {/* CUSTOMER */}
      <Text style={styles.customer}>{order.partner_id?.[1]}</Text>

      {/* WARNING */}
      {qtyChanged && (
        <View style={styles.warningBox}>
          <Ionicons name="alert-circle" size={18} color="#b45309" />
          <Text style={styles.warningText}>
            Quantity changed. Please update before payment.
          </Text>
        </View>
      )}

      {/* ORDER LINES */}
      <FlatList
        data={lines}
        keyExtractor={(i) => i.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 260 }}
      />

      {/* SUMMARY */}
      <View style={styles.summary}>
        <View style={styles.row}>
          <Text style={styles.label}>Subtotal</Text>
          <Text style={styles.value}>LKR {Number(order.amount_untaxed).toFixed(2)}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Tax</Text>
          <Text style={styles.value}>LKR {Number(order.amount_tax).toFixed(2)}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>LKR {Number(order.amount_total).toFixed(2)}</Text>
        </View>
      </View>

      {/* ACTIONS */}
      <View style={styles.bottomBar}>
        {qtyChanged && (
          <TouchableOpacity
            style={styles.updateBtn}
            onPress={updateQty}
            disabled={loading}
          >
            <Text style={styles.btnText}>Update Quantity</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          disabled={qtyChanged || loading}
          style={[
            styles.payBtn,
            qtyChanged && { backgroundColor: "#9ca3af" },
          ]}
          onPress={() =>
            navigation.navigate("ProceedPayment", {
              saleOrderId: order.id,
              total: order.amount_total,
            })
          }
        >
          <Text style={styles.btnText}>Proceed to Payment</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    padding: 16,
  },

  customer: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 12,
    color: "#111",
  },

  warningBox: {
    flexDirection: "row",
    backgroundColor: "#fef3c7",
    padding: 10,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },

  warningText: {
    marginLeft: 8,
    color: "#92400e",
    fontWeight: "600",
  },

  card: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 18,
    marginBottom: 12,
    elevation: 4,
  },

  product: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 14,
  },

  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },

  qtyBtn: {
    backgroundColor: "#2563eb",
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  qtyValue: {
    marginHorizontal: 16,
    fontSize: 18,
    fontWeight: "800",
    minWidth: 40,
    textAlign: "center",
  },

  price: {
    fontSize: 16,
    fontWeight: "800",
    color: "#2563eb",
    textAlign: "right",
  },

  summary: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 18,
    marginBottom: 90,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },

  label: {
    color: "#555",
  },

  value: {
    fontWeight: "600",
  },

  totalLabel: {
    fontSize: 16,
    fontWeight: "800",
  },

  totalValue: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111",
  },

  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    padding: 16,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    elevation: 14,
  },

  updateBtn: {
    backgroundColor: "#f59e0b",
    paddingVertical: 14,
    borderRadius: 16,
    marginBottom: 10,
    alignItems: "center",
  },

  payBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
  },

  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
});
