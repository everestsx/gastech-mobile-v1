import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";

import { confirmSaleOrder } from "../services/saleOrderLine.service";
import {
  getPickingBySaleOrder,
  getMoveLines,
  updateMoveLineQty,
  validatePicking,
} from "../services/delivery.service";

export default function ProceedPaymentScreen({ route, navigation }) {
  const { saleOrderId, total } = route.params;
  const [loading, setLoading] = useState(false);

  /* ---------------- MAIN FLOW ---------------- */
  const handleProceed = async () => {
    try {
      setLoading(true);

      /* 1️⃣ Confirm Sale Order */
      await confirmSaleOrder(saleOrderId);

      /* 2️⃣ Get Picking */
      const pickings = await getPickingBySaleOrder(saleOrderId);
      if (!pickings.length) {
        throw new Error("No delivery order found");
      }

      const picking = pickings[0];

      /* 3️⃣ Get Move Lines */
      const moveLines = await getMoveLines(picking.move_line_ids);

      /* 4️⃣ SET qty_done = demand */
      for (let ml of moveLines) {
        const demandQty = ml.product_uom_qty;

        if (demandQty > 0) {
          await updateMoveLineQty(ml.id, demandQty);
        }
      }

      /* 5️⃣ Validate Picking */
      await validatePicking(picking.id);

      Alert.alert("Success", "Order delivered successfully");

      navigation.reset({
        index: 0,
        routes: [{ name: "Home" }],
      });
    } catch (err) {
      console.error(err);
      Alert.alert(
        "Delivery Error",
        err.message || "Failed to complete delivery"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Confirm Payment</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Total Amount</Text>
        <Text style={styles.total}>Rs. {total}</Text>
      </View>

      <TouchableOpacity
        style={styles.payBtn}
        onPress={handleProceed}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Confirm & Deliver</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#f3f4f6",
    justifyContent: "center",
  },

  title: {
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 24,
  },

  card: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 18,
    marginBottom: 30,
    elevation: 5,
  },

  label: {
    color: "#6b7280",
    marginBottom: 6,
  },

  total: {
    fontSize: 24,
    fontWeight: "900",
    color: "#111",
  },

  payBtn: {
    backgroundColor: "#16a34a",
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: "center",
  },

  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
});
