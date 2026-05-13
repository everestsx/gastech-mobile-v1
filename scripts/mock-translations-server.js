const http = require('http');

const PORT = 3000;

// This is the mock payload that the app will fetch
const mockPayload = {
  // Bump version to trigger a cache update
  version: "1.0.10",
  translations: {
    en: {
      translation: {
        login: {
          preferences: "PREFERENCES",
          credentials: "CREDENTIALS",
          vehicleID: "Vehicle IDD",
          driverPin: "Driver pin",
          yourDriverPin: "Your driver pin",
          login: "Login"
        }
      }
    },
    si: {
      translation: {
        login: {
          preferences: "මනාප",
          credentials: "අක්තපත්‍ර",
          vehicleID: "වාහන හැඳුනුම්පත",

          // PURPOSELY OMITTING "driverPin"
          // It should fall back to the offline file's "රියදුරු PIN එක"

          // Changing this to prove the API payload is actually arriving
          yourDriverPin: "--- API PIN ---",

          login: "ලොග් වන්න"
        }
      }
    }
  }
};

const server = http.createServer((req, res) => {
  // CORS headers just in case (e.g. testing from web)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // The app will request /api/translations
  if (req.method === 'GET' && req.url.startsWith('/api/translations')) {
    console.log(`[${new Date().toLocaleTimeString()}] Received request for ${req.url}`);

    // You can inspect the Bearer token here if needed
    // const authHeader = req.headers.authorization;
    // console.log(`Auth Header: ${authHeader}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockPayload, null, 2));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Mock Translations API Server running!`);
  console.log(`Endpoint: http://localhost:${PORT}/api/translations`);
  console.log(`\nTo test this on your phone/emulator, update your .env file:`);
  console.log(`ODOO_URL=http://<YOUR_COMPUTER_IP_ADDRESS>:${PORT}`);
  console.log(`\nPress Ctrl+C to stop.\n`);
});
