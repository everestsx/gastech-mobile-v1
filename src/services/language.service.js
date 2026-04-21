import AsyncStorage from '@react-native-async-storage/async-storage';

const TRANSLATIONS_STORAGE_KEY = '@gastech_translations';
const TRANSLATIONS_VERSION_KEY = '@gastech_translations_version';

/**
 * MOCK API FUNCTION
 * This simulates the backend endpoint that the Odoo backend team will create.
 * It returns the translation dictionaries for all supported languages.
 */
const mockFetchLanguagesFromOdoo = async () => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 800));

  return {
    version: '1.0.3', // Important: Increment this when backend labels change to force a redownload!
    translations: {
      en: {
        translation: {
          dashboard: {
            title: 'Dashboard',
            showCreateSalesOrder: 'Show Create Sales Order card',
            showReturnOrder: 'Show Return Order card',
            lastSynced: 'Last Synced',
            visit: 'Visit',
            salesToday: 'Sales Today',
            cash: 'CASH',
            cheque: 'CHEQUE',
            credit: 'CREDIT',
            ordersCompleted: 'ORDERS COMPLETED',
            complete: 'Complete',
            gasDelivered: 'GAS DELIVERED',
            done: 'Done',
            portersOnShift: 'Porters on shift',
            yourCommissionToday: 'YOUR COMMISSION TODAY',
            createSalesOrder: 'Create Sales Order',
            returnOrder: 'Return Order',
            chooseRoute: 'Choose route',
            recommendedToday: 'Recommended (today)',
            onHandStock: 'On Hand Stock',
            delivered: 'Delivered',
            emptyCollected: 'Empty Collected',
            noStockDataAvailable: 'No stock data available.'
          },
          settings: {
            title: 'Settings',
            appearance: 'Appearance',
            darkMode: 'Dark mode',
            language: 'Language',
            appLanguage: 'App language',
            languageNames: {
              english: 'English',
              tamil: 'Tamil',
              sinhala: 'Sinhala',
            },
            sync: 'Sync',
            syncPeriod: 'Sync Period',
            syncTime: 'Sync Time',
            syncDateField: 'Sync Date Field',
            syncPeriodOptions: {
              last7Days: 'Last 7 days',
              last30Days: 'Last 30 days',
              last90Days: 'Last 90 days',
              last1Year: 'Last 1 year',
              allTime: 'All time',
            },
            syncTimeOptions: {
              oneMinute: '1 minute',
              fiveMinutes: '5 minutes',
              tenMinutes: '10 minutes',
              thirtyMinutes: '30 minutes',
              oneHour: '1 hour',
              twoHours: '2 hours',
            },
            syncDateOptions: {
              creationDate: 'Creation date',
              deliveryDate: 'Delivery date',
            },
            app: 'App',
            notifications: 'Notifications',
            about: 'About',
            help: 'Help & Support',
            privacy: 'Privacy',
            notAvailableYet: 'Not available yet.',
            aboutMessage: 'GasTech Delivery v1.0',
            helpMessage: 'Support options are not available yet.',
            privacyMessage: 'Privacy policy is not available yet.',
            close: 'Close',
          },
          navigation: {
            home: 'Home',
            orders: 'Orders',
            delivered: 'Delivered',
            menu: 'Menu',
            back: 'Back',
            myCustomers: 'My Customers',
            dailyVisit: 'Daily Visit',
            myStocks: 'My Stocks',
            myCommissions: 'My Commissions',
            syncHistory: 'Sync History',
            myInvoices: 'My Invoices',
            settings: 'Settings',
            bluetoothPrinter: 'Bluetooth printer',
            orderDetails: 'Order Details',
            payment: 'Payment',
            emptyCylinders: 'Empty Cylinders',
            invoice: 'Invoice',
            paymentProof: 'Payment proof',
            scanResult: 'Scan result',
            customerQRGenerator: 'Customer QR Generator',
          },
          drawer: {
            title: 'Gas Cylinder Delivery',
            driver: 'Driver',
            syncing: 'Syncing...',
            syncData: 'Sync data',
            lastSync: 'Last sync: {{date}}',
            notSyncedYet: 'Not synced yet',
            autoSyncHint: 'Auto-sync runs every {{interval}} minutes when app is open.',
            syncFailed: 'Sync failed',
            syncDone: 'Sync done',
            syncDoneMessage: '{{customers}} customers · {{orders}} orders',
            areYouSure: 'Are you sure?',
            cancel: 'Cancel',
          },
          menu: {
            myCustomers: 'My Customers',
            dailyVisit: 'Daily Visit',
            myStocks: 'My Stocks',
            myCommission: 'My Commission',
            bluetoothPrinter: 'Bluetooth printer',
            myInvoices: 'My Invoices',
            syncHistory: 'Sync History',
            settings: 'Settings',
            checkForUpdates: 'Check for Updates',
            logOut: 'Log out',
            sync: 'Sync',
            syncing: 'Syncing...',
            checkAppUpdate: 'Check app update',
            checkingUpdates: 'Checking updates...',
            deleteLocalData: 'Delete local data',
            deleteLocalDataMessage: 'Removes customers, orders, and other synced data on this phone. You stay logged in. Sync again to reload from GasTech. Continue?',
            cancel: 'Cancel',
            delete: 'Delete',
            done: 'Done',
            deletedTapSyncAgain: 'Deleted. Tap Sync to download data again.',
            notEverythingIsSynced: 'Not everything is synced',
            pendingSyncMessage: '{{queue}} item(s) in queue, {{attachments}} photo(s) not sent yet. Sync first, or delete anyway and lose those items on the server.',
            discardAndDelete: 'Discard & delete',
            deletedUnsyncedDropped: 'Deleted (unsynced items were dropped). Tap Sync to reload.',
            error: 'Error',
            failedToDeleteLocalData: 'Failed to delete local data.',
            updateReady: 'Update ready',
            updateReadyMessage: 'The latest update has been downloaded. Restart the app now?',
            later: 'Later',
            restartNow: 'Restart now',
            restartFailed: 'Restart failed',
            closeAndReopen: 'Please close and reopen the app.',
            updateFailed: 'Update failed',
            couldNotDownloadUpdate: 'Could not download update. Try again.',
            updatesUnavailable: 'Updates unavailable',
            otaNotSupported: 'This app build does not support OTA updates. Install an EAS-built update-enabled APK first.',
            upToDate: 'Up to date',
            alreadyOnLatestUpdate: 'You are already on the latest app update.',
            updateAvailable: 'Update available',
            newerUpdateAvailable: 'A newer app update is available. Download now?',
            updateNow: 'Update now',
            otaOnlyInRelease: 'OTA updates work only in installed release/internal builds, not Expo Go/dev mode.',
            updateCheckFailed: 'Update check failed',
            couldNotCheckForUpdates: 'Could not check for updates.',
            areYouSure: 'Are you sure?',
            admin: 'Admin',
            tapToOpenSettings: 'Tap to open Settings',
            tapForSettings: '{{vehicle}} · Tap for settings',
            vehicle: 'Vehicle'
          },
          common: {
            loading: 'Loading...'
          }
        }
      },
      si: {
        translation: {
          bluetoothprinter: {
            bluetoothPrinter: "බ්ලූටූත් මුද්‍රණ යන්ත්‍රය",
            bluetoothRongtaPrinter: "බ්ලූටූත් Rongta මුද්‍රණ යන්ත්‍රය",
            clear: "මකන්න",
            pairedBluetoothPrinters: "සම්බන්ධිත මුද්‍රණ යන්ත්‍ර",
            refreshList: "ලැයිස්තුව නැවුම් කරන්න"
          },
          customers: {
            noCustomersYet: "තවමත් පාරිභෝගිකයින් නැත",
            syncFromMenuToLoadCustomers: "පාරිභෝගිකයින් පූරණය කිරීමට මෙනුවෙන් සමමුහුර්ත කරන්න"
          },
          dailyvisit: {
            showingOneCustomerTapToShowAll: "එක් පාරිභෝගිකයෙක් පෙන්වයි - සියල්ල බැලීමට තට්ටු කරන්න",
            done: "අවසන්"
          },
          deliveredorders: {
            done: "අවසන්",
            clear: "මකන්න",
            customerName: "පාරිභෝගික නම",
            orderID: "ඇණවුම් අංකය",
            all: "සියල්ල",
            cash: "මුදල්",
            cheque: "චෙක්පත්",
            credit: "ණය"
          },
          emptycylindercollection: {
            emptyCylinderCollection: "හිස් සිලින්ඩර එකතු කිරීම",
            emptyCollected: "එකතු කළ හිස් සිලින්ඩර",
            resetToDefault: "පෙරනිමියට යළි පිහිටුවන්න",
            continueToInvoice: "ඉන්වොයිසිය වෙත යන්න"
          },
          home: {
            welcomeToMyApp: "මගේ යෙදුමට සාදරයෙන් පිළිගනිමු",
            Dashboard: "📊 උපකරණ පුවරුව",
            QRGenerator: "🔲 QR සාදන්නා",
            SalesOrders: "🛒 විකුණුම් ඇණවුම්"
          },
          invoice: {
            "0ScaleIndex": "0 && scaleIndex",
            noLineItems: "අයිතම නැත",
            gasTech: "GasTech",
            driverName: "රියදුරු නම:",
            vehicleNo: "වාහන අංකය:",
            supplierSTIN: "සැපයුම්කරුගේ TIN:",
            supplierSName: "සැපයුම්කරුගේ නම:",
            address: "ලිපිනය",
            telephoneNo: "දුරකථන අංකය:",
            purchaserSTIN: "ගැනුම්කරුගේ TIN:",
            purchaserSName: "ගැනුම්කරුගේ නම:",
            no: "අංකය",
            description: "අයිතමය",
            qty: "ප්‍රමාණය",
            unitPrice: "ඒකක මිල",
            amountExcludingVAT: "VAT රහිත මුදල",
            totalValueOfSupply: "මුළු සැපයුම් වටිනාකම:",
            vATAmount18: "VAT මුදල (18%):",
            totalAmountIncludingVAT: "VAT සමඟ මුළු මුදල:",
            totalAmountInWords: "වචනයෙන් මුළු මුදල:",
            modeOfPayment: "ගෙවීම් ක්‍රමය:",
            bankCheque: "බැංකුව (චෙක්පත්):",
            chequeNo: "චෙක්පත් අංකය:",
            thankYouForYourBusiness: "ඔබගේ ව්‍යාපාරයට ස්තූතියි",
            driverSignature: "රියදුරු අත්සන",
            customerSignature: "පාරිභෝගික අත්සන",
            gasTechYourTrustedBusinessPartner: "GasTech - ඔබගේ විශ්වාසවන්ත ව්‍යාපාරික සහකරු",
            poweredByEverestsxCom: "everestsx.com මගින් බලගන්වයි",
            invoiceNo: "ඉන්වොයිස් අංකය",
            date: "දිනය",
            customer: "පාරිභෝගිකයා",
            product: "නිෂ්පාදනය",
            total: "එකතුව",
            subtotal: "අතුරු එකතුව",
            vAT: "VAT",
            proceedToPayment: "ගෙවීමට යන්න",
            close: "වසා දමන්න",
            bluetoothPrinter: "බ්ලූටූත් මුද්‍රණ යන්ත්‍රය",
            connectNow: "දැන් සම්බන්ධ කරන්න",
            clearSavedPrinter: "සුරකින ලද මුද්‍රණ යන්ත්‍රය මකන්න",
            fullBluetoothSettings: "සම්පූර්ණ බ්ලූටූත් සැකසුම්",
            pairedDevices: "සම්බන්ධිත උපාංග",
            refreshList: "ලැයිස්තුව නැවුම් කරන්න",
            printInvoice: "ඉන්වොයිසිය මුද්‍රණය කරන්න",
            printing: "මුද්‍රණය වෙමින් පවතී...",
            rePrint: "නැවත මුද්‍රණය",
            continueWithoutPrinting: "මුද්‍රණය නොකර ඉදිරියට යන්න",
            signToConfirmDelivery: "බෙදාහැරීම තහවුරු කිරීමට අත්සන් කරන්න",
            clear: "මකන්න",
            saveSignatures: "අත්සන් සුරකින්න",
            deliveryPhotos: "බෙදාහැරීමේ ඡායාරූප",
            takePhoto: "ඡායාරූපයක් ගන්න",
            choosePhoto: "ඡායාරූපයක් තෝරන්න",
            skip: "මඟ හරින්න",
            connectToPrinter: "මුද්‍රණ යන්ත්‍රයට සම්බන්ධ කරන්න"
          },
          localinvoices: {
            invoices: "ඉන්වොයිසි",
            invoiceDate: "ඉන්වොයිස් දිනය",
            order: "ඇණවුම",
            customer: "පාරිභෝගිකයා",
            total: "එකතුව"
          },
          login: {
            deliveryTerminal: "බෙදාහැරීමේ පරිශ්‍රය",
            authorizedDistributorPortal: "බලයලත් පිළිගත් වෙළෙන්දන්ගේ ද්වාරය",
            vehicleID: "වාහන අංකය",
            noVehiclesFound: "වාහන හමු නොවීය.",
            driverPin: "රියදුරු PIN අංකය",
            login: "පුරනය වන්න",
            signedInAsDriver: "රියදුරෙකු ලෙස ප්‍රවේශ වී ඇත",
            ifThisIsYouContinueToPickPortersForThisVehicle: "මෙය ඔබ නම්, මෙම වාහනය සඳහා කම්කරුවන් තෝරා ගැනීමට ඉදිරියට යන්න.",
            back: "ආපසු",
            continue: "ඉදිරියට යන්න",
            whoSOnThisShift: "මෙම මුරයෙහි කවුද ඉන්නේ?",
            tapToSelect: "තෝරා ගැනීමට තට්ටු කරන්න",
            goToDashboard: "උපකරණ පුවරුවට යන්න",
            yourDriverPin: "ඔබගේ රියදුරු PIN අංකය",
            searchByNameOrCode: "නම හෝ කේතය මඟින් සොයන්න"
          },
          mycommission: {
            loadingCommissionHistory: "කොමිස් ඉතිහාසය පූරණය වෙමින් පවතී...",
            dailyCommissionHistory: "දෛනික කොමිස් ඉතිහාසය",
            gasDelivered: "බෙදාහරින ලද ගෑස්",
            commissionRate: "කොමිස් අනුපාතය",
            calculation: "ගණනය කිරීම",
            totalCommission: "සමස්ත කොමිස් මුදල"
          },
          paymentproof: {
            missingOrder: "ඇණවුම අස්ථානගත වී ඇත.",
            goBack: "ආපසු යන්න",
            paymentProof: "ගෙවීම් සාක්ෂි",
            takePhoto: "ඡායාරූපයක් ගන්න",
            gallery: "ගැලරිය",
            completePayment: "ගෙවීම සම්පූර්ණ කරන්න",
            completeThisOrder: "මෙම ඇණවුම සම්පූර්ණ කරන්නද?",
            keepOrder: "ඇණවුම තබා ගන්න",
            yesComplete: "ඔව්, සම්පූර්ණ කරන්න"
          },
          placeholder: {
            comingSoon: "ළඟදීම..."
          },
          proceedpayment: {
            subTotal: "අතුරු එකතුව",
            vAT18: "VAT (18%)",
            paymentTotal: "ගෙවීම් එකතුව",
            totalAmount: "මුළු මුදල",
            paymentMethod: "ගෙවීම් ක්‍රමය",
            cash: "මුදල්",
            cheque: "චෙක්පත්",
            credit: "ණය",
            amountPaid: "ගෙවන ලද මුදල",
            rs: "රු.",
            chooseBank: "බැංකුව තෝරන්න",
            loading: "පූරණය වෙමින්...",
            changeBank: "බැංකුව වෙනස් කරන්න",
            chequeNumber: "චෙක්පත් අංකය",
            confirmPayment: "ගෙවීම තහවුරු කරන්න",
            searchBank: "බැංකුව සොයන්න...",
            check: "චෙක්පත් #"
          },
          qrgenerate: {
            customerQRGenerator: "පාරිභෝගික QR සාදන්නා",
            "1ChooseCustomer": "1) පාරිභෝගිකයා තෝරන්න",
            generateQR: "QR සාදන්න",
            downloadQR: "QR බාගන්න",
            savedAsPNGInYourGalleryForPrintingOrSharing: "මුද්‍රණය හෝ බෙදාගැනීම සඳහා ගැලරියේ PNG ලෙස සුරකින ලදි.",
            typeCustomerName: "පාරිභෝගිකයාගේ නම ඇතුළත් කරන්න..."
          },
          saleorderdetails: {
            unitPrice: "ඒකක මිල",
            lineTotal: "පේළියේ එකතුව",
            orderNotFound: "ඇණවුම හමු නොවීය",
            thisOrderHasBeenCancelled: "මෙම ඇණවුම අවලංගු කර ඇත.",
            tapToContinue: "ඉදිරියට යාමට තට්ටු කරන්න.",
            order: "ඇණවුම",
            orderLines: "ඇණවුම් විස්තර",
            save: "සුරකින්න",
            modifyOrder: "ඇණවුම වෙනස් කරන්න",
            noLineItems: "අයිතම නැත",
            subTotal: "අතුරු එකතුව",
            vAT18: "VAT (18%)",
            proceedToPayment: "ගෙවීමට යන්න",
            cancelOrder: "ඇණවුම අවලංගු කරන්න",
            cancelThisOrder: "මෙම ඇණවුම අවලංගු කරන්නද?",
            keepOrder: "ඇණවුම තබා ගන්න",
            continue: "ඉදිරියට යන්න",
            reasonForCancellation: "අවලංගු කිරීමට හේතුව",
            loadingReasons: "හේතු පූරණය වෙමින්..."
          },
          saleorderlist: {
            done: "අවසන්",
            customerName: "පාරිභෝගික නම",
            orderID: "ඇණවුම් අංකය"
          },
          scanqrcode: {
            checkingCamera: "කැමරාව පරීක්ෂා කරමින්...",
            cameraPermissionIsRequiredToScanCustomerQRCodes: "පාරිභෝගික QR ස්කෑන් කිරීමට කැමරා අවසරය අවශ්‍ය වේ.",
            grantPermission: "අවසර ලබා දෙන්න",
            lookingUpCustomer: "පාරිභෝගිකයා සොයමින් පවතී...",
            tapToScanAgain: "නැවත ස්කෑන් කිරීමට තට්ටු කරන්න"
          },
          scanresult: {
            backToOrders: "ඇණවුම් වෙත ආපසු යන්න"
          },
          splash: {
            gasTech: "GasTech",
            smartCylinderDelivery: "ස්මාර්ට් සිලින්ඩර බෙදාහැරීම"
          },
          synchistory: {
            noSyncHistoryYet: "තවමත් සමමුහුර්ත ඉතිහාසයක් නොමැත"
          },
          vehiclestock: {
            onHandStock: "අතැති තොගය",
            orderedStock: "ඇණවුම් කළ තොගය",
            extraStock: "අතිරේක තොගය",
            delivered: "බෙදාහැර ඇත",
            emptyCollected: "එකතු කළ හිස් සිලින්ඩර",
            emptyStock: "හිස් තොගය",
            loadingVehicleStock: "වාහන තොගය පූරණය වෙමින්...",
            itemWiseStock: "අයිතම අනුව තොගය",
            noVehicleInSession: "සැසියේ වාහනයක් නොමැත",
            logInWithAVehicleToSeeLorryStock: "ලොරි තොගය බැලීමට වාහනයක් සමඟ ප්‍රවේශ වන්න."
          },
          dashboard: {
            title: 'උපකරණ පුවරුව',
            showCreateSalesOrder: 'නව විකුණුම් ඇණවුමක් තනන්න කාඩ්පත පෙන්වන්න',
            showReturnOrder: 'ආපසු ඇණවුම් කාඩ්පත පෙන්වන්න',
            lastSynced: 'අවසන් සමමුහුර්තය',
            visit: 'සංචාරය',
            salesToday: 'අද විකුණුම්',
            cash: 'මුදල්',
            cheque: 'චෙක්පත්',
            credit: 'ණය',
            ordersCompleted: 'සම්පූර්ණ කළ ඇණවුම්',
            gasDelivered: 'බෙදාහරින ලද ගෑස්',
            done: 'අවසන්',
            portersOnShift: 'මුරයේ කම්කරුවන්',
            yourCommissionToday: 'අද ඔබගේ කොමිස්',
            createSalesOrder: 'නව විකුණුම් ඇණවුමක් සාදන්න',
            returnOrder: 'ආපසු ඇණවුම',
            chooseRoute: 'මාර්ගය තෝරන්න',
            recommendedToday: 'නිර්දේශිත (අද)',
            onHandStock: 'අතැති තොගය',
            delivered: 'බෙදාහැර ඇත',
            emptyCollected: 'එකතු කළ හිස් සිලින්ඩර',
            noStockDataAvailable: 'තොග දත්ත නොමැත.'
          },
          settings: {
            title: 'සැකසුම්',
            appearance: 'පෙනුම',
            darkMode: 'අඳුරු තේමාව',
            language: 'භාෂාව',
            appLanguage: 'යෙදුමේ භාෂාව',
            languageNames: {
              english: 'ඉංග්‍රීසි',
              tamil: 'දමිළ',
              sinhala: 'සිංහල',
            },
            sync: 'සමමුහුර්තකරණය',
            syncPeriod: 'සමමුහුර්ත කාලය',
            syncTime: 'සමමුහුර්ත වේලාව',
            syncDateField: 'සමමුහුර්ත දිනය',
            syncPeriodOptions: {
              last7Days: 'පසුගිය දින 7',
              last30Days: 'පසුගිය දින 30',
              last90Days: 'පසුගිය දින 90',
              last1Year: 'පසුගිය වසර 1',
              allTime: 'සියලුම කාලය',
            },
            syncTimeOptions: {
              oneMinute: '1 මිනිත්තුව',
              fiveMinutes: '5 මිනිත්තු',
              tenMinutes: '10 මිනිත්තු',
              thirtyMinutes: '30 මිනිත්තු',
              oneHour: '1 පැය',
              twoHours: 'පැය 2',
            },
            syncDateOptions: {
              creationDate: 'නිර්මාණ දිනය',
              deliveryDate: 'බෙදාහැරීමේ දිනය',
            },
            app: 'යෙදුම',
            notifications: 'නිවේදන',
            about: 'අපි ගැන',
            help: 'උපකාර සහ සහාය',
            privacy: 'පෞද්ගලිකත්වය',
            notAvailableYet: 'තවම ලබාගත නොහැක.',
            aboutMessage: 'GasTech Delivery v1.0',
            helpMessage: 'සහාය විකල්ප තවම ලබාගත නොහැක.',
            privacyMessage: 'පෞද්ගලිකත්ව ප්‍රතිපත්තිය තවම ලබාගත නොහැක.',
            close: 'වසා දමන්න',
          },
          navigation: {
            home: 'මුල් පිටුව',
            orders: 'ඇණවුම්',
            delivered: 'බෙදාහැරීම්',
            menu: 'මෙනුව',
            back: 'ආපසු',
            myCustomers: 'මගේ පාරිභෝගිකයින්',
            dailyVisit: 'දෛනික සංචාරය',
            myStocks: 'මගේ තොග',
            myCommissions: 'මගේ කොමිස්',
            syncHistory: 'සමමුහුර්ත ඉතිහාසය',
            myInvoices: 'මගේ ඉන්වොයිසි',
            settings: 'සැකසුම්',
            bluetoothPrinter: 'බ්ලූටූත් මුද්‍රණ යන්ත්‍රය',
            orderDetails: 'ඇණවුම් විස්තර',
            payment: 'ගෙවීම',
            emptyCylinders: 'හිස් සිලින්ඩර',
            invoice: 'ඉන්වොයිසිය',
            paymentProof: 'ගෙවීම් සාක්ෂි',
            scanResult: 'ස්කෑන් ප්‍රතිඵලය',
            customerQRGenerator: 'පාරිභෝගික QR සාදන්නා',
          },
          drawer: {
            title: 'ගෑස් සිලින්ඩර් බෙදාහැරීම',
            driver: 'රියදුරු',
            syncing: 'සමමුහුර්ත වෙමින්...',
            syncData: 'දත්ත සමමුහුර්ත කරන්න',
            lastSync: 'අවසන් සමමුහුර්තය: {{date}}',
            notSyncedYet: 'තවම සමමුහුර්ත කර නැත',
            autoSyncHint: 'යෙදුම විවෘතව ඇති විට සෑම {{interval}} මිනිත්තු마다 ස්වයංක්‍රීය සමමුහුර්තය ක්‍රියාත්මක වේ.',
            syncFailed: 'සමමුහුර්තය අසාර්ථකයි',
            syncDone: 'සමමුහුර්තය අවසන්',
            syncDoneMessage: '{{customers}} පාරිභෝගිකයින් · {{orders}} ඇණවුම්',
            areYouSure: 'ඔබට විශ්වාසද?',
            cancel: 'අවලංගු කරන්න',
          },
          menu: {
            myCustomers: 'මගේ පාරිභෝගිකයින්',
            dailyVisit: 'දෛනික සංචාරය',
            myStocks: 'මගේ තොග',
            myCommission: 'මගේ කොමිස්',
            bluetoothPrinter: 'බ්ලූටූත් මුද්‍රණ යන්ත්‍රය',
            myInvoices: 'මගේ ඉන්වොයිසි',
            syncHistory: 'සමමුහුර්ත ඉතිහාසය',
            settings: 'සැකසුම්',
            checkForUpdates: 'යාවත්කාලීන පරීක්ෂා කරන්න',
            logOut: 'ඉවත්වන්න',
            sync: 'සමමුහුර්ත කරන්න',
            syncing: 'සමමුහුර්ත වෙමින්...',
            checkAppUpdate: 'යෙදුම් යාවත්කාලීනය පරීක්ෂා කරන්න',
            checkingUpdates: 'යාවත්කාලීන පරීක්ෂා වෙමින්...',
            deleteLocalData: 'ස්ථානීය දත්ත මකන්න',
            deleteLocalDataMessage: 'මෙම දුරකථනයේ පාරිභෝගික, ඇණවුම් සහ අනෙකුත් සමමුහුර්ත දත්ත මකා දමයි. ඔබ පුරනය වීමෙන් ඉවත් නොවේ. GasTech වෙතින් නැවත ලබා ගැනීමට නැවත සමමුහුර්ත කරන්න. ඉදිරියට යන්නද?',
            cancel: 'අවලංගු කරන්න',
            delete: 'මකන්න',
            done: 'අවසන්',
            deletedTapSyncAgain: 'මකා දමන ලදී. නැවත දත්ත ගන්න Sync තට්ටු කරන්න.',
            notEverythingIsSynced: 'සියල්ල සමමුහුර්ත වී නැත',
            pendingSyncMessage: 'පෝලිමේ {{queue}} අයිතම, තවම යවා නැති {{attachments}} ඡායාරූප ඇත. මුලින් Sync කරන්න හෝ මකා දමා සේවාදායක දත්ත අහිමි කරන්න.',
            discardAndDelete: 'ඉවත දමා මකන්න',
            deletedUnsyncedDropped: 'මකා දමන ලදී (සමමුහුර්ත නොවූ දත්ත ඉවත් කරන ලදී). නැවත පූරණය කිරීමට Sync තට්ටු කරන්න.',
            error: 'දෝෂය',
            failedToDeleteLocalData: 'ස්ථානීය දත්ත මකා දැමීමට අසමත් විය.',
            updateReady: 'යාවත්කාලීනය සූදානම්',
            updateReadyMessage: 'නවතම යාවත්කාලීනය බාගත කර ඇත. දැන් යෙදුම නැවත ආරම්භ කරන්නද?',
            later: 'පසුව',
            restartNow: 'දැන් නැවත ආරම්භ කරන්න',
            restartFailed: 'නැවත ආරම්භ කිරීම අසාර්ථකයි',
            closeAndReopen: 'කරුණාකර යෙදුම වසා නැවත විවෘත කරන්න.',
            updateFailed: 'යාවත්කාලීන කිරීම අසාර්ථකයි',
            couldNotDownloadUpdate: 'යාවත්කාලීනය බාගත කළ නොහැක. නැවත උත්සාහ කරන්න.',
            updatesUnavailable: 'යාවත්කාලීන නොලැබේ',
            otaNotSupported: 'මෙම build එක OTA යාවත්කාලීන සඳහා සහය නොදක්වයි. EAS build APK එකක් ස්ථාපනය කරන්න.',
            upToDate: 'යාවත්කාලීන',
            alreadyOnLatestUpdate: 'ඔබ දැනටමත් නවතම යෙදුම් අනුවාදය භාවිතා කරයි.',
            updateAvailable: 'යාවත්කාලීනයක් ඇත',
            newerUpdateAvailable: 'නව යෙදුම් යාවත්කාලීනයක් ඇත. දැන් බාගත කරන්නද?',
            updateNow: 'දැන් යාවත්කාලීන කරන්න',
            otaOnlyInRelease: 'OTA යාවත්කාලීන ස්ථාපිත release/internal builds වල පමණක් ක්‍රියා කරයි; Expo Go/dev mode වල නොවේ.',
            updateCheckFailed: 'යාවත්කාලීන පරීක්ෂාව අසාර්ථකයි',
            couldNotCheckForUpdates: 'යාවත්කාලීන පරීක්ෂා කළ නොහැක.',
            areYouSure: 'ඔබට විශ්වාසද?',
            admin: 'පරිපාලක',
            tapToOpenSettings: 'සැකසුම් විවෘත කිරීමට තට්ටු කරන්න',
            tapForSettings: '{{vehicle}} · සැකසුම් සඳහා තට්ටු කරන්න',
            vehicle: 'වාහනය'
          },
          common: {
            loading: 'ප්‍රවේශ වෙමින්...'
          }
        }
      },
      ta: {
        translation: {
          bluetoothprinter: {
            bluetoothPrinter: "புளூடூத் அச்சுப்பொறி",
            bluetoothRongtaPrinter: "புளூடூத் Rongta அச்சுப்பொறி",
            clear: "அழிக்கவும்",
            pairedBluetoothPrinters: "இணைக்கப்பட்ட அச்சுப்பொறிகள்",
            refreshList: "பட்டியலைப் புதுப்பிக்கவும்"
          },
          customers: {
            noCustomersYet: "இன்னும் வாடிக்கையாளர்கள் இல்லை",
            syncFromMenuToLoadCustomers: "வாடிக்கையாளர்களை ஏற்ற மெனுவிலிருந்து ஒத்திசைக்கவும்"
          },
          dailyvisit: {
            showingOneCustomerTapToShowAll: "ஒரு வாடிக்கையாளரைக் காட்டுகிறது - அனைத்தையும் காண தட்டவும்",
            done: "முடிந்தது"
          },
          deliveredorders: {
            done: "முடிந்தது",
            clear: "அழிக்கவும்",
            customerName: "வாடிக்கையாளர் பெயர்",
            orderID: "ஆர்டர் எண்",
            all: "அனைத்தும்",
            cash: "பணம்",
            cheque: "காசோலை",
            credit: "கடன்"
          },
          emptycylindercollection: {
            emptyCylinderCollection: "காலி சிலிண்டர் சேகரிப்பு",
            emptyCollected: "காலி சேகரிக்கப்பட்டது",
            resetToDefault: "இயல்புநிலைக்கு மீட்டமை",
            continueToInvoice: "விலைப்பட்டியலுக்குத் தொடரவும்"
          },
          home: {
            welcomeToMyApp: "எனது செயலிக்கு வருக",
            Dashboard: "📊 முகப்பு",
            QRGenerator: "🔲 QR ரேகை",
            SalesOrders: "🛒 விற்பனை ஆர்டர்கள்"
          },
          invoice: {
            "0ScaleIndex": "0 && scaleIndex",
            noLineItems: "பொருட்கள் இல்லை",
            gasTech: "GasTech",
            taxInvoice: "வரி விலைப்பட்டியல்",
            driverName: "ஓட்டுநர் பெயர்:",
            vehicleNo: "வாகன எண்:",
            supplierSTIN: "சப்ளையர் TIN:",
            supplierSName: "சப்ளையர் பெயர்:",
            address: "முகவரி",
            telephoneNo: "தொலைபேசி எண்:",
            purchaserSTIN: "வாங்குபவர் TIN:",
            purchaserSName: "வாங்குபவர் பெயர்:",
            no: "எண்",
            description: "விவரம்",
            qty: "அளவு",
            unitPrice: "அலகு விலை",
            amountExcludingVAT: "VAT நீங்கலான தொகை",
            totalValueOfSupply: "மொத்த விநியோக மதிப்பு:",
            vATAmount18: "VAT தொகை (18%):",
            totalAmountIncludingVAT: "VAT உட்பட மொத்த தொகை:",
            totalAmountInWords: "மொத்த தொகை வார்த்தைகளில்:",
            modeOfPayment: "பணம் செலுத்தும் முறை:",
            bankCheque: "வங்கி (காசோலை):",
            chequeNo: "காசோலை எண்:",
            thankYouForYourBusiness: "உங்கள் வணிகத்திற்கு நன்றி",
            driverSignature: "ஓட்டுநர் கையொப்பம்",
            customerSignature: "வாடிக்கையாளர் கையொப்பம்",
            gasTechYourTrustedBusinessPartner: "GasTech - உங்கள் நம்பகமான கூட்டாளர்",
            poweredByEverestsxCom: "everestsx.com மூலம் இயக்கப்படுகிறது",
            invoiceNo: "விலைப்பட்டியல் எண்",
            date: "தேதி",
            customer: "வாடிக்கையாளர்",
            product: "பொருள்",
            total: "மொத்தம்",
            subtotal: "துணை மொத்தம்",
            vAT: "VAT",
            proceedToPayment: "பணம் செலுத்த தொடரவும்",
            close: "மூடு",
            bluetoothPrinter: "புளூடூத் அச்சுப்பொறி",
            connectNow: "இப்போது இணைக்கவும்",
            clearSavedPrinter: "சேமிக்கப்பட்ட அச்சுப்பொறியை அழிக்கவும்",
            fullBluetoothSettings: "முழு புளூடூத் அமைப்புகள்",
            pairedDevices: "இணைக்கப்பட்ட சாதனங்கள்",
            refreshList: "பட்டியலைப் புதுப்பிக்கவும்",
            printInvoice: "விலைப்பட்டியலை அச்சிடுக",
            printing: "அச்சிடுகிறது...",
            rePrint: "மீண்டும் அச்சிடு",
            continueWithoutPrinting: "அச்சிடாமல் தொடரவும்",
            signToConfirmDelivery: "டெலிவரியை உறுதிப்படுத்த கையொப்பமிடுங்கள்",
            clear: "அழிக்கவும்",
            saveSignatures: "கையொப்பங்களை சேமிக்கவும்",
            deliveryPhotos: "டெலிவரி புகைப்படங்கள்",
            takePhoto: "புகைப்படம் எடுக்கவும்",
            choosePhoto: "புகைப்படத்தைத் தேர்ந்தெடுக்கவும்",
            skip: "தவிர்",
            connectToPrinter: "அச்சுப்பொறியுடன் இணைக்கவும்"
          },
          localinvoices: {
            invoices: "விலைப்பட்டியல்கள்",
            invoiceDate: "விலைப்பட்டியல் தேதி",
            order: "ஆர்டர்",
            customer: "வாடிக்கையாளர்",
            total: "மொத்தம்"
          },
          login: {
            deliveryTerminal: "டெலிவரி முனையம்",
            authorizedDistributorPortal: "அங்கீகரிக்கப்பட்ட விநியோகஸ்தர் போர்டல்",
            vehicleID: "வாகன எண்",
            noVehiclesFound: "வாகனங்கள் கிடைக்கவில்லை.",
            driverPin: "ஓட்டுநர் PIN",
            login: "உள்நுழைய",
            signedInAsDriver: "ஓட்டுநராக உள்நுழைந்துள்ளீர்கள்",
            ifThisIsYouContinueToPickPortersForThisVehicle: "இது நீங்களானால், தொழிலாளர்களைத் தேர்ந்தெடுக்க தொடரவும்.",
            back: "பின்னே",
            continue: "தொடரவும்",
            whoSOnThisShift: "இந்த ஷிப்டில் யார் இருக்கிறார்கள்?",
            tapToSelect: "தேர்ந்தெடுக்கத் தட்டவும்",
            goToDashboard: "முகப்புக்குச் செல்",
            yourDriverPin: "உங்கள் ஓட்டுநர் PIN",
            searchByNameOrCode: "பெயர் அல்லது குறியீட்டைக் கொண்டு தேடுக"
          },
          mycommission: {
            loadingCommissionHistory: "கமிஷன் வரலாற்றை ஏற்றுகிறது...",
            dailyCommissionHistory: "தினசரி கமிஷன் வரலாறு",
            gasDelivered: "விநியோகிக்கப்பட்ட எரிவாயு",
            commissionRate: "கமிஷன் விகிதம்",
            calculation: "கணக்கீடு",
            totalCommission: "மொத்த கமிஷன்"
          },
          paymentproof: {
            missingOrder: "ஆர்டர் காணவில்லை.",
            goBack: "திரும்பிச் செல்",
            paymentProof: "பணம் செலுத்தியதற்கான சான்று",
            takePhoto: "புகைப்படம் எடுக்கவும்",
            gallery: "தொகுப்பு",
            completePayment: "பணம் செலுத்துவதை முடி",
            completeThisOrder: "இந்த ஆர்டரை முடிக்க வேண்டுமா?",
            keepOrder: "ஆர்டரை வைத்திருக்கவும்",
            yesComplete: "ஆம், முடிக்கவும்"
          },
          placeholder: {
            comingSoon: "விரைவில்..."
          },
          proceedpayment: {
            subTotal: "துணை மொத்தம்",
            vAT18: "VAT (18%)",
            paymentTotal: "மொத்த கட்டணம்",
            totalAmount: "மொத்த தொகை",
            paymentMethod: "பணம் செலுத்தும் முறை",
            cash: "பணம்",
            cheque: "காசோலை",
            credit: "கடன்",
            amountPaid: "செலுத்தப்பட்ட தொகை",
            rs: "ரூ.",
            chooseBank: "வங்கியைத் தேர்ந்தெடுக்கவும்",
            loading: "ஏற்றுகிறது...",
            changeBank: "வங்கியை மாற்றவும்",
            chequeNumber: "காசோலை எண்",
            confirmPayment: "கட்டணத்தை உறுதிப்படுத்தவும்",
            searchBank: "வங்கியைத் தேடுக...",
            check: "காசோலை #"
          },
          qrgenerate: {
            customerQRGenerator: "வாடிக்கையாளர் QR ரேகை",
            "1ChooseCustomer": "1) வாடிக்கையாளரைத் தேர்வுசெய்யவும்",
            generateQR: "QR உருவாக்கு",
            downloadQR: "QR பதிவிறக்கு",
            savedAsPNGInYourGalleryForPrintingOrSharing: "அச்சிட அல்லது பகிர உங்கள் கேலரியில் PNG ஆக சேமிக்கப்பட்டது.",
            typeCustomerName: "வாடிக்கையாளர் பெயரை உள்ளிடவும்..."
          },
          saleorderdetails: {
            unitPrice: "விலை",
            lineTotal: "மொத்தம்",
            orderNotFound: "ஆர்டர் கிடைக்கவில்லை",
            thisOrderHasBeenCancelled: "இந்த ஆர்டர் ரத்து செய்யப்பட்டது.",
            tapToContinue: "தொடர தட்டவும்.",
            order: "ஆர்டர்",
            orderLines: "ஆர்டர் விவரங்கள்",
            save: "சேமி",
            modifyOrder: "மாற்றியமை",
            noLineItems: "பொருட்கள் இல்லை",
            subTotal: "துணை மொத்தம்",
            vAT18: "VAT (18%)",
            proceedToPayment: "பணம் செலுத்த தொடரவும்",
            cancelOrder: "ஆர்டரை ரத்துசெய்",
            cancelThisOrder: "இந்த ஆர்டரை ரத்துசெய்ய வேண்டுமா?",
            keepOrder: "ஆர்டரை வைத்திருக்கவும்",
            continue: "தொடரவும்",
            reasonForCancellation: "ரத்துசெய்ததற்கான காரணம்",
            loadingReasons: "காரணங்களை ஏற்றுகிறது..."
          },
          saleorderlist: {
            done: "முடிந்தது",
            customerName: "வாடிக்கையாளர் பெயர்",
            orderID: "ஆர்டர் எண்"
          },
          scanqrcode: {
            checkingCamera: "கேமராவைச் சரிபார்க்கிறது...",
            cameraPermissionIsRequiredToScanCustomerQRCodes: "QR ஐ ஸ்கேன் செய்ய கேமரா அனுமதி தேவை.",
            grantPermission: "அனுமதி வழங்கு",
            lookingUpCustomer: "வாடிக்கையாளரைத் தேடுகிறது...",
            tapToScanAgain: "மீண்டும் ஸ்கேன் செய்ய தட்டவும்"
          },
          scanresult: {
            backToOrders: "ஆர்டர்களுக்குத் திரும்பு"
          },
          splash: {
            gasTech: "GasTech",
            smartCylinderDelivery: "ஸ்மார்ட் சிலிண்டர் டெலிவரி"
          },
          synchistory: {
            noSyncHistoryYet: "இன்னும் ஒத்திசைவு வரலாறு இல்லை"
          },
          vehiclestock: {
            onHandStock: "கையிருப்பு",
            orderedStock: "ஆர்டர் செய்யப்பட்ட இருப்பு",
            extraStock: "கூடுதல் இருப்பு",
            delivered: "விநியோகிக்கப்பட்டது",
            emptyCollected: "காலி சேகரிக்கப்பட்டது",
            emptyStock: "காலி இருப்பு",
            loadingVehicleStock: "வாகன இருப்பை ஏற்றுகிறது...",
            itemWiseStock: "பொருள் வாரியான இருப்பு",
            noVehicleInSession: "அமர்வில் வாகனம் இல்லை",
            logInWithAVehicleToSeeLorryStock: "லாரி இருப்பைக் காண வாகனத்துடன் உள்நுழையவும்."
          },
          dashboard: {
            title: 'முகப்பு',
            showCreateSalesOrder: 'புதிய விற்பனை ஒழுங்கை உருவாக்கு கார்டை காட்டு',
            showReturnOrder: 'திருப்பி அனுப்பு கார்டை காட்டு',
            lastSynced: 'கடைசியாக ஒத்திசைக்கப்பட்டது',
            visit: 'விஜயம்',
            salesToday: 'இன்றைய விற்பனை',
            cash: 'பணம்',
            cheque: 'காசோலை',
            credit: 'கடன்',
            ordersCompleted: 'முடிக்கப்பட்ட ஆர்டர்கள்',
            gasDelivered: 'விநியோகிக்கப்பட்ட எரிவாயு',
            done: 'முடிந்தது',
            portersOnShift: 'ஷிப்டில் உள்ள தொழிலாளர்கள்',
            yourCommissionToday: 'இன்றைய உங்கள் கமிஷன்',
            createSalesOrder: 'விற்பனை ஆர்டர் உருவாக்கு',
            returnOrder: 'திரும்பும் ஆர்டர்',
            chooseRoute: 'பாதையைத் தேர்ந்தெடுக்கவும்',
            recommendedToday: 'பரிந்துரைக்கப்பட்டது (இன்று)',
            onHandStock: 'கையிருப்பு',
            delivered: 'விநியோகிக்கப்பட்டது',
            emptyCollected: 'காலி சேகரிக்கப்பட்டது',
            noStockDataAvailable: 'இருப்பு தரவு இல்லை.'
          },
          settings: {
            title: 'அமைப்புகள்',
            appearance: 'தோற்றம்',
            darkMode: 'டார்க் மோட்',
            language: 'மொழி',
            appLanguage: 'செயலி மொழி',
            languageNames: {
              english: 'ஆங்கிலம்',
              tamil: 'தமிழ்',
              sinhala: 'சிங்களம்',
            },
            sync: 'ஒத்திசைவு',
            syncPeriod: 'ஒத்திசைவு காலம்',
            syncTime: 'ஒத்திசைவு நேரம்',
            syncDateField: 'ஒத்திசைவு தேதிலம்',
            syncPeriodOptions: {
              last7Days: 'கடந்த 7 நாட்கள்',
              last30Days: 'கடந்த 30 நாட்கள்',
              last90Days: 'கடந்த 90 நாட்கள்',
              last1Year: 'கடந்த 1 வருடம்',
              allTime: 'எல்லா காலமும்',
            },
            syncTimeOptions: {
              oneMinute: '1 நிமிடம்',
              fiveMinutes: '5 நிமிடங்கள்',
              tenMinutes: '10 நிமிடங்கள்',
              thirtyMinutes: '30 நிமிடங்கள்',
              oneHour: '1 மணி நேரம்',
              twoHours: '2 மணி நேரங்கள்',
            },
            syncDateOptions: {
              creationDate: 'உருவாக்க தேதி',
              deliveryDate: 'டெலிவரி தேதி',
            },
            app: 'செயலி',
            notifications: 'அறிவிப்புகள்',
            about: 'பற்றி',
            help: 'உதவி & ஆதரவு',
            privacy: 'தனியுரிமை',
            notAvailableYet: 'இன்னும் கிடைக்கவில்லை.',
            aboutMessage: 'GasTech Delivery v1.0',
            helpMessage: 'ஆதரவு விருப்பங்கள் இன்னும் கிடைக்கவில்லை.',
            privacyMessage: 'தனியுரிமைக் கொள்கை இன்னும் கிடைக்கவில்லை.',
            close: 'மூடு',
          },
          navigation: {
            home: 'முகப்பு',
            orders: 'ஆர்டர்கள்',
            delivered: 'விநியோகிக்கப்பட்டது',
            menu: 'மெனு',
            back: 'பின்னால்',
            myCustomers: 'என் வாடிக்கையாளர்கள்',
            dailyVisit: 'தினசரி விஜயம்',
            myStocks: 'என் இருப்பு',
            myCommissions: 'என் கமிஷன்',
            syncHistory: 'ஒத்திசைவு வரலாறு',
            myInvoices: 'என் விலைப்பட்டியல்கள்',
            settings: 'அமைப்புகள்',
            bluetoothPrinter: 'புளூடூத் அச்சுப்பொறி',
            orderDetails: 'ஆர்டர் விவரங்கள்',
            payment: 'பணம் செலுத்துதல்',
            emptyCylinders: 'காலி சிலிண்டர்கள்',
            invoice: 'விலைப்பட்டியல்',
            paymentProof: 'பணம் செலுத்திய சான்று',
            scanResult: 'ஸ்கேன் முடிவு',
            customerQRGenerator: 'வாடிக்கையாளர் QR ரேகை',
          },
          drawer: {
            title: 'காஸ் சிலிண்டர் டெலிவரி',
            driver: 'ஓட்டுநர்',
            syncing: 'ஒத்திசைக்கிறது...',
            syncData: 'தரவுகளை ஒத்திசை',
            lastSync: 'கடைசி ஒத்திசைவு: {{date}}',
            notSyncedYet: 'இன்னும் ஒத்திசைக்கப்படவில்லை',
            autoSyncHint: 'செயலி திறந்திருக்கும் போது ஒவ்வொரு {{interval}} நிமிடங்களுக்கும் தானியங்கி ஒத்திசைவு இயங்குகிறது.',
            syncFailed: 'ஒத்திசைவு தோல்வியடைந்தது',
            syncDone: 'ஒத்திசைவு முடிந்தது',
            syncDoneMessage: '{{customers}} வாடிக்கையாளர்கள் · {{orders}} ஆர்டர்கள்',
            areYouSure: 'நீங்கள் உறுதியாக உள்ளீர்களா?',
            cancel: 'ரத்து',
          },
          menu: {
            myCustomers: 'என் வாடிக்கையாளர்கள்',
            dailyVisit: 'தினசரி விஜயம்',
            myStocks: 'என் இருப்பு',
            myCommission: 'என் கமிஷன்',
            bluetoothPrinter: 'புளூடூத் அச்சுப்பொறி',
            myInvoices: 'என் விலைப்பட்டியல்கள்',
            syncHistory: 'ஒத்திசைவு வரலாறு',
            settings: 'அமைப்புகள்',
            checkForUpdates: 'புதுப்பிப்புகளைச் சரிபார்க்கவும்',
            logOut: 'வெளியேறு',
            sync: 'ஒத்திசை',
            syncing: 'ஒத்திசைக்கிறது...',
            checkAppUpdate: 'புதுப்பிப்பைச் சரிபார்க்கவும்',
            checkingUpdates: 'புதுப்பிப்புகளைச் சரிபார்க்கிறது...',
            deleteLocalData: 'உள்ளூர் தரவை நீக்கு',
            deleteLocalDataMessage: 'இந்த தொலைபேசியில் உள்ள வாடிக்கையாளர்கள், ஆர்டர்கள் மற்றும் பிற ஒத்திசைக்கப்பட்ட தரவுகளை நீக்கும். நீங்கள் உள்நுழைந்தே இருப்பீர்கள். மீண்டும் ஒத்திசைத்து GasTech இலிருந்து ஏற்றவும். தொடரவா?',
            cancel: 'ரத்து',
            delete: 'நீக்கு',
            done: 'முடிந்தது',
            deletedTapSyncAgain: 'நீக்கப்பட்டது. மீண்டும் தரவைப் பெற Sync ஐத் தட்டவும்.',
            notEverythingIsSynced: 'எல்லாம் ஒத்திசைக்கப்படவில்லை',
            pendingSyncMessage: 'வரிசையில் {{queue}} உருப்படிகள், {{attachments}} புகைப்படங்கள் இன்னும் அனுப்பப்படவில்லை. முதலில் ஒத்திசைக்கவும், அல்லது இங்கேயே நீக்கி சேவையகத்தில் உள்ள அவற்றை இழக்கவும்.',
            discardAndDelete: 'நீக்கி கைவிடவும்',
            deletedUnsyncedDropped: 'நீக்கப்பட்டது (ஒத்திசைக்கப்படாத உருப்படிகள் அகற்றப்பட்டன). மீண்டும் ஏற்ற Sync ஐத் தட்டவும்.',
            error: 'பிழை',
            failedToDeleteLocalData: 'உள்ளூர் தரவை நீக்க முடியவில்லை.',
            updateReady: 'புதுப்பிப்பு தயார்',
            updateReadyMessage: 'சமீபத்திய புதுப்பிப்பு பதிவிறக்கப்பட்டது. இப்போது செயலியை மறுதொடக்கம் செய்வீர்களா?',
            later: 'பின்னர்',
            restartNow: 'இப்போது மறுதொடக்கம் செய்',
            restartFailed: 'மறுதொடக்கம் தோல்வியடைந்தது',
            closeAndReopen: 'செயலியை மூடி மீண்டும் திறக்கவும்.',
            updateFailed: 'புதுப்பிப்பு தோல்வியடைந்தது',
            couldNotDownloadUpdate: 'புதுப்பிப்பை பதிவிறக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
            updatesUnavailable: 'புதுப்பிப்புகள் கிடைக்கவில்லை',
            otaNotSupported: 'இந்த செயலி கட்டுமானம் OTA புதுப்பிப்புகளை ஆதரிக்காது. முதலில் EAS-ஆல் கட்டப்பட்ட APK ஒன்றை நிறுவவும்.',
            upToDate: 'தற்போது புதுப்பிக்கப்பட்டுள்ளது',
            alreadyOnLatestUpdate: 'நீங்கள் ஏற்கனவே சமீபத்திய செயலி புதுப்பிப்பில் உள்ளீர்கள்.',
            updateAvailable: 'புதுப்பிப்பு கிடைக்கிறது',
            newerUpdateAvailable: 'புதிய செயலி புதுப்பிப்பு கிடைக்கிறது. இப்போது பதிவிறக்கவா?',
            updateNow: 'இப்போது புதுப்பிக்கவும்',
            otaOnlyInRelease: 'OTA புதுப்பிப்புகள் நிறுவப்பட்ட release/internal builds-இல் மட்டும் இயங்கும்; Expo Go/dev mode-இல் இல்லை.',
            updateCheckFailed: 'புதுப்பிப்பு சரிபார்ப்பு தோல்வியடைந்தது',
            couldNotCheckForUpdates: 'புதுப்பிப்புகளைச் சரிபார்க்க முடியவில்லை.',
            areYouSure: 'நீங்கள் உறுதியாக உள்ளீர்களா?',
            admin: 'நிர்வாகி',
            tapToOpenSettings: 'அமைப்புகளைத் திறக்க தட்டவும்',
            tapForSettings: '{{vehicle}} · அமைப்புகளுக்குத் தட்டவும்',
            vehicle: 'வாகனம்'
          },
          common: {
            loading: 'ஏற்றுகிறது...'
          }
        }
      }
    }
  };
};

/**
 * Core function to fetch and cache translations
 * To be called on app startup or manual sync
 */
export const syncLanguageDictionaries = async () => {
  try {
    // Check local version
    const cachedVersion = await AsyncStorage.getItem(TRANSLATIONS_VERSION_KEY);

    // TODO: In the future, you could hit a lightweight /api/language/version endpoint 
    // to check if a download is even necessary before downloading the full JSON payload.

    // Fetch from "Backend"
    const response = await mockFetchLanguagesFromOdoo();
    
    // If backend has a newer version (or we don't have one), update cache
    if (!cachedVersion || cachedVersion !== response.version) {
      await AsyncStorage.setItem(TRANSLATIONS_STORAGE_KEY, JSON.stringify(response.translations));
      await AsyncStorage.setItem(TRANSLATIONS_VERSION_KEY, response.version);
      console.log('Language dictionaries synced and cached successfully.');
      return response.translations;
    } else {
      console.log('Language dictionaries are up to date.');
      // Return cached translations
      const cachedTranslations = await AsyncStorage.getItem(TRANSLATIONS_STORAGE_KEY);
      return cachedTranslations ? JSON.parse(cachedTranslations) : response.translations;
    }
  } catch (error) {
    console.error('Error syncing language dictionaries:', error);
    // On error (e.g., offline), fallback to whatever is in the cache
    const cachedTranslations = await AsyncStorage.getItem(TRANSLATIONS_STORAGE_KEY);
    return cachedTranslations ? JSON.parse(cachedTranslations) : null;
  }
};

/**
 * Retrieve the current cached dictionary
 */
export const getCachedTranslations = async () => {
  try {
    const cached = await AsyncStorage.getItem(TRANSLATIONS_STORAGE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('Failed to get cached translations', error);
    return null;
  }
};
