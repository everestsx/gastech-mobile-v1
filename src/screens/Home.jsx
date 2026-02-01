import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

export default function HomeScreen({ navigation }) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ alignItems: 'center' }}>
      <Text style={styles.title}>Welcome to My App</Text>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('dashboard')}
        activeOpacity={0.7}
      >
        <Text style={styles.cardText}>📊 Dashboard</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => {navigation.navigate('QrGenerate'),console.log("hellow")}}
        activeOpacity={0.7}
      >
        <Text style={styles.cardText}>🔲 QR Generator</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('SalesOrder')}
        // onPress={() =>  console.log("Sale order list")}
        activeOpacity={0.7}
      >
        <Text style={styles.cardText}>🛒 Sales Orders</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f2',
    paddingVertical: 50,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 30,
    color: '#333',
  },
  card: {
    width: '90%',
    backgroundColor: '#fff',
    paddingVertical: 20,
    paddingHorizontal: 15,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 5, // for Android shadow
  },
  cardText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a73e8',
  },
});
