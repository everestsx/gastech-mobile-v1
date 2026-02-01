import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from '../screens/Home'
import DashboardScreen from '../screens/dashboardScreen'
import QrGenerateScreen from '../screens/qrGenarateScreen'
import SaleOrderDetailsScreen from '../screens/SaleOrderDetailsScreen'
import  SaleOrderListScreen from '../screens/SaleOrderListScreen'
import ProceedPaymentScreen from '../screens/ProceedPaymentScreen'
import InvoiceScreen from '../screens/invoiceScreen'


const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: true,   // hide top header
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name='dashboard' component={DashboardScreen}/>
        <Stack.Screen name='QrGenerate' component={QrGenerateScreen}/>
        <Stack.Screen name="SaleOrderDetails" component={SaleOrderDetailsScreen} />
        <Stack.Screen name="SalesOrder" component={SaleOrderListScreen} />
         <Stack.Screen name="ProceedPayment" component={ProceedPaymentScreen} />
         <Stack.Screen name="InvoiceScreen" component={InvoiceScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
