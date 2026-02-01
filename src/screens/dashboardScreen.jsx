import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View,SafeAreaView, SafeAreaViewBase, TouchableOpacity,TextInput } from 'react-native';
import QRCode from 'react-native-qrcode-svg';


export default function DashboardScreen() {
  // const [text,SetText] = useState("")
  const [url,SetUrl] = useState("")
  const [isQrGenerated,setIsQrGenarator] = useState(false)
  return (
    <SafeAreaView style={styles.container}>
       <View style={styles.view1}/>
       <View style={styles.view2}/>
       <View style={styles.maincontainer}>
      <Text style={{fontSize:54,color:'white',fontWeight:'400'}}>QR</Text>
      <Text style={{fontSize:54,color:'white',fontWeight:'400'}}>Genarator</Text>
      <View style={styles.subcontainer}>
           <View style={{flexDirection:"row",gap:10}}>
              <TextInput
                style={styles.input}
                placeholder="Enter Url Here..."
                placeholderTextColor={'gray'}
                onChangeText={text => {SetUrl(text);setIsQrGenarator(false)}}
              />
              <TouchableOpacity style={styles.button} onPress={() => setIsQrGenarator(true)}>
                <Text style={{color:'white',fontSize:16}}>Genarate QR</Text>
              </TouchableOpacity>
           </View>
           <View style={{marginVertical:80,borderColor:'white',borderWidth:1,padding:20,backgroundColor:'white'}}>
            {
              isQrGenerated && url?
              <QRCode size={200} value={url}/>:
              <View style={{height:200,width:200,justifyContent:"center",alignItems:'center'}}>
                <Text style={{fontSize:20}}>QR Code Here</Text>
              </View>

            } 
             
           </View>
      </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgb(10,10,10)',
   position:'relative'
  },
  view1:{
    width:300,
    height:200,
    backgroundColor:'rgb(26,40,66)',
    position:'absolute',
    top:0,
    right:0,
    borderBottomLeftRadius:'100%'
  },
  view2:{
    width:250,
    height:250,
    backgroundColor:'rgb(26,40,66)',
    position:'absolute',
    bottom:0,
   left:0,
    borderTopRightRadius:'100%'
  },
  maincontainer:{
    padding:20
  },
  subcontainer:{
    marginTop:80,
    justifyContent:'center',
    alignItems:'center'
  },
  input:{
   backgroundColor:'rgb(28,28,28)',
   fontSize:20,
   paddingVertical:10,
   paddingHorizontal:16,
   color:'white',
   borderRadius:10,
   flex:1
  },
  button:{
    backgroundColor:'rgb(37,162,171)',
    justifyContent:'center',
    alignItems:'center',
    paddingHorizontal:10,
    borderRadius:10,
    paddingVertical:10
  }
});
