/**
 * Thermal Receipt View Component
 * Optimized for Rongta thermal printers (576px width)
 * Renders invoice data in thermal-printer-friendly format
 */

import { View, Text, Image, StyleSheet } from 'react-native';

export default function ThermalReceiptView({ data, signature }) {
  const {
    companyName = 'GasTech',
    invoiceNumber,
    date,
    customer,
    customerTIN,
    supplierTIN,
    lineItems = [],
    grossAmount,
    vatAmount,
    netAmount,
    paymentInfo,
    chequeBankName,
    chequeNumber,
  } = data || {};

  return (
    <View style={styles.container}>
      {/* Company Header */}
      <Text style={styles.companyHeader}>{companyName}</Text>
      <Text style={styles.invoiceTitle}>TAX INVOICE</Text>
      <View style={styles.divider} />

      {/* Invoice Details */}
      <View style={styles.section}>
        <Text style={styles.label}>Invoice No: {invoiceNumber || 'N/A'}</Text>
        <Text style={styles.label}>Date: {date || 'N/A'}</Text>
        <Text style={styles.label}>Customer: {customer || 'N/A'}</Text>
        
        {customerTIN && (
          <Text style={styles.label}>Customer TIN: {customerTIN}</Text>
        )}
        
        {supplierTIN && (
          <Text style={styles.label}>Supplier TIN: {supplierTIN}</Text>
        )}
      </View>

      <View style={styles.divider} />

      {/* Line Items Header */}
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderText, styles.colItem]}>Item</Text>
        <Text style={[styles.tableHeaderText, styles.colQty]}>Qty</Text>
        <Text style={[styles.tableHeaderText, styles.colTotal]}>Total</Text>
      </View>

      {/* Line Items */}
      {lineItems.map((item, index) => (
        <View key={index} style={styles.tableRow}>
          <Text style={[styles.tableCell, styles.colItem]} numberOfLines={2}>
            {item.name || 'Item'}
          </Text>
          <Text style={[styles.tableCell, styles.colQty]}>
            {item.qty || '0'}
          </Text>
          <Text style={[styles.tableCell, styles.colTotal]}>
            {item.total || '0.00'}
          </Text>
        </View>
      ))}

      <View style={styles.divider} />

      {/* Totals Section */}
      <View style={styles.totalsSection}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Gross Amount:</Text>
          <Text style={styles.totalValue}>Rs {grossAmount || '0.00'}</Text>
        </View>
        
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>VAT (18%):</Text>
          <Text style={styles.totalValue}>Rs {vatAmount || '0.00'}</Text>
        </View>
        
        <View style={[styles.totalRow, styles.netTotalRow]}>
          <Text style={styles.netTotalLabel}>NET AMOUNT:</Text>
          <Text style={styles.netTotalValue}>Rs {netAmount || '0.00'}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Payment Information */}
      <View style={styles.paymentSection}>
        <Text style={styles.paymentLabel}>Payment:</Text>
        <Text style={styles.paymentValue}>{paymentInfo || 'Cash'}</Text>
      </View>

      {chequeBankName && (
        <Text style={styles.chequeInfo}>Bank: {chequeBankName}</Text>
      )}
      
      {chequeNumber && (
        <Text style={styles.chequeInfo}>Cheque No: {chequeNumber}</Text>
      )}

      {/* Customer Signature */}
      {signature && (
        <View style={styles.signatureSection}>
          <Text style={styles.signatureLabel}>Customer Signature:</Text>
          <Image 
            source={{ uri: signature }} 
            style={styles.signatureImage}
            resizeMode="contain"
          />
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Thank you for your business</Text>
        <Text style={styles.footerSubtext}>Powered by everestx.com</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 576, // Rongta SDK maximum width (thermal printer standard)
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  companyHeader: {
    fontSize: 36,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#000000',
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  invoiceTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#000000',
    marginBottom: 12,
    fontFamily: 'monospace',
  },
  divider: {
    height: 2,
    backgroundColor: '#000000',
    marginVertical: 12,
  },
  section: {
    marginBottom: 8,
  },
  label: {
    fontSize: 16,
    color: '#000000',
    marginBottom: 6,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#000000',
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  tableHeaderText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
    fontFamily: 'monospace',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#CCCCCC',
  },
  tableCell: {
    fontSize: 14,
    color: '#000000',
    fontFamily: 'monospace',
  },
  colItem: {
    flex: 3,
    textAlign: 'left',
  },
  colQty: {
    flex: 1,
    textAlign: 'right',
  },
  colTotal: {
    flex: 2,
    textAlign: 'right',
  },
  totalsSection: {
    marginVertical: 8,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  totalLabel: {
    fontSize: 16,
    color: '#000000',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 16,
    color: '#000000',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  netTotalRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: '#000000',
  },
  netTotalLabel: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000000',
    fontFamily: 'monospace',
  },
  netTotalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000000',
    fontFamily: 'monospace',
  },
  paymentSection: {
    alignItems: 'center',
    marginVertical: 12,
  },
  paymentLabel: {
    fontSize: 14,
    color: '#000000',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  paymentValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  chequeInfo: {
    fontSize: 14,
    color: '#000000',
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 4,
  },
  signatureSection: {
    marginTop: 16,
    marginBottom: 8,
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  signatureImage: {
    width: 300,
    height: 100,
    borderWidth: 1,
    borderColor: '#CCCCCC',
  },
  footer: {
    marginTop: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 16,
    color: '#000000',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 12,
    color: '#666666',
    fontFamily: 'monospace',
    fontStyle: 'italic',
  },
});
