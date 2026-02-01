import { View, Text, StyleSheet } from "react-native";

export default function InvoiceScreen({ route }) {
  return (
    <View style={styles.center}>
      <Text style={styles.done}>✅ Invoice Created</Text>
      <Text>Sale Order #{route.params.saleOrderId}</Text>
    </View>
  );
}


const styles = StyleSheet.create({
    center:{
        display:'flex',
        justifyContent:'center',
        alignItems:'center'
    },
    done:{fontSize:30}
})