# SERVER.JS
## Initialize
Menginisialisasi variabel global
```javascript
const os = require('os');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const express = require('express');
const http = require("http");
const path = require('path');
```

### Credential Variables
Menginisialisasi credential variables untuk MQTT dan WebSocket
```javascript
const MQTT_BROKER = '35.226.15.168';
const MQTT_PORT = 1883;
const MQTT_URL = `mqtt://${MQTT_BROKER}:${MQTT_PORT}`;
const WSS_PORT = 8080;
const HOST_PORT = 3000;
const MQTT_TOPIC = 'temp';

const username = 'esp32user';
const password = 'windows10';
```
**Penjelasan:**
- `MQTT_TOPIC` disesuaikan sesuai topic yang ingin di-*subscribe*

>**Note:**
>Port masih belum fix

### Create Server
```javascript
// membuat server
const app = express();
const server = http.createServer(app);
app.use(express.static(path.join(__dirname, 'public')));
```
**Penjelasan:**
- Membuat object `express()` dengan variable `app`
- Membuat server dengan mengambil parameter *object* `app`
- Object `app` akan mengeksekusi semua *files* yang berada di *folder* `public`

> **Notice**:
> Terdapat `server` dan `app`
> `app` = berfungsi untuk menginisialisasi website
> `server` = berfungsi untuk menginisialisasi Server 

### Fungsi `getLocalIP()`
Berfungsi untuk mendapatkan local IP dari laptop agar nanti bisa diakses oleh device lain yang satu jaringan.
```javascript
function getLocalIP() {
  const networkInterfaces = os.networkInterfaces();
  const candidates = [];

  for (const interfaceName in networkInterfaces) {
    const networkInterface = networkInterfaces[interfaceName];
    for (const network of networkInterface) {
      // Skip alamat internal
      if (network.internal || network.family !== "IPv4") {
        continue;
      }
      // Prioritaskan alamat Wi-Fi
      if (interfaceName.toLowerCase().includes("wi-fi")) {
        return network.address;
      }
      candidates.push(network.address);
    }
  }
  return candidates.length > 0 ? candidates[0] : "localhost";
}
```
**Penjelasan:**
- Bagian kode: `if (network.internal || network.family !== "IPv4") { continue; }`
  memastikan hanya alamat IP eksternal dan IPv4 yang diambil
- Iterasi dilanjutkan dengan pengondisian untuk memrioritaskan alamat Wi-Fi --> dimasukkan 
- Secara default, akan me-*return* alamat `localhost`

### WebSocket
#### WebSocket Server
``` javascript
let wss;
try {
    wss = new WebSocket.Server({
        server: 
    });
} catch (error) {
    if (error.code === 'EADDRINUSE') {
        console.log('Port sudah digunakan, mohon coba port lain');
    } else {
	    console.log(`Error: ${error}`);
    }
}
```
**Penjelasan:**
- Membuat *object* WebSocket Server dengan variabel `wss`

#### WebSocket Client
WebSocket Client dibuat ketika `ws` (WebSocket Server) memiliki *connection*

**ws.send()**
```javascript
wsClient.push(ws);
console.log(`\n🟢  Client ${req.socket.remoteAddress} berhasil terhubung`);

// welcome client
const welcomeMessage = {
	type: 'welcome',
	message: `Selamat datang di topic '${MQTT_TOPIC}'`,
	clientCount: wsClient.length
};

try {
	ws.send(JSON.stringify(welcomeMessage));    // diubah jadi string agar bisa dikirim ke client
} catch (error) {
	console.log(`Error: ${error}`)
	if (error.code === 'ECONNRESET') {
		console.log('Client terhubung, tetapi tidak ada respons dari client');
	}
	// error ketika data JSON formatnya salah
	else if (error.code === 'ERR_INVALID_ARG_TYPE') {
		console.log('Data JSON tidak valid');
	}
}
```
**Penjelasan:**
- ws.send() untuk *testing* saja apakah sudah masuk atau belum

**ws.on('message')**
```javascript
ws.on('message', (message) => {
    try{
		const data = JSON.parse(message);
		console.log('Message dari client:', data);
	} catch (error) {
		if (error.code === 'ERR_INVALID_ARG_TYPE') {
			console.log('Data JSON tidak valid');
		} else {
			console.log(`Error: ${error}`);
		}
	}
})
```
**Penjelasan:**
- Digunakan untuk meng-*handle* *message* jika ada
- Akan mem-*parse* *message* tersebut agar menjadi *object* JSON --> disimpan di variabel `data`

**ws.on('error')**
```javascript
ws.on('error', (error) => {
    if (error.code === 'ECONNRESET') {
        console.log('Client terhubung, tetapi tidak ada respons dari client');
        }
    else {
	    console.log(`Error: ${error}`)
    }
})
```
**Penjelasan:**
- Ketika terjadi error

**ws.on('close')**
```javascript
ws.on('close', (code, reason) => {
	console.log(`\n🔴  Client ${req.socket.remoteAddress} terputus`);
	console.log(`Browser client disconnected. Code: ${code}, Reason: ${reason}`);
	wsClient = wsClient.filter(client => client !== ws);
	console.log(`Active connections: ${wsClient.length}`);
})
```
**Penjelasan:**
- Ketika koneksi terputus
### MQTT
#### Initialize MQTT Client
```javascript
console.log('Connecting to MQTT broker...');
const mqttClient = mqtt.connect(
    MQTT_URL,
    {
        username: username,
        clean: true,
        password: password,
        reconnectPeriod: 1000,
        connectTimeout: 10 * 1000,
    }
);
```
**Penjelasan:**
- Membuat koneksi ke MQTT dengan membuat `mqttClient`
- Memasukkan `MQTT_URL` beserta *credential* lainnya
#### Connecting MQTT Client
```javascript
// connect mqtt client ke topic jika bisa konek
mqttClient.on('connect', () => {
    console.log('🟢  MQTT client terhubung ke broker');
    mqttClient.subscribe(MQTT_TOPIC, (err) => {
        if (err) {
            console.log(`Error: ${err}`)
            process.exit(1);
        }
        console.log(`🟢  MQTT client berhasil subscribe topic '${MQTT_TOPIC}'`);
        console.log('🟡  Menunggu data...')
    });
});
```
**Penjelasan:**
- Jika terhubung, maka akan *subscribe* ke topic `MQTT_TOPIC`
#### Message Handler
```javascript
// mqtt client menerima data dari mqtt broker
mqttClient.on('message', (topic, message) => {
    try{
        const data = JSON.parse(message);
        console.log(`\nMessage dari MQTT topic '${topic}':\n`, data);

        // mengirim data ke semua client
        wsClient.forEach((client, index) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    const wsMessage = {
                        type: 'data_monitor',
                        data: data,
                        timestamp: new Date().toISOString()
                    };
                    client.send(JSON.stringify(wsMessage));
                } catch (error) {
                    console.log(`Error: ${error}`)
                    if (error.code === 'ERR_INVALID_ARG_TYPE') {
                        console.log('Data JSON tidak valid');
                    }
                    process.exit(1);
                }
            } else {
                console.log(`Client ${index} tidak terhubung`);
            }
        });

        // clean up
        wsClient = wsClient.filter(client => client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING);
    } catch (error) {
        console.log(`Error: ${error}`)
        if (error.code === 'ERR_INVALID_ARG_TYPE') {
            console.log('Data JSON tidak valid');
        }
        process.exit(1);
    }
});
```
**Penjelasan:**
- Mem-*parsing* *message* menjadi *object* JSON dan menyimpan ke `data`
- Mengirim ke semua `wsClient` 
	- Membuat `wsMessage` --> untuk membuat JSON dengan content yang sama dengan `data`
	- Menjadikan `wsMessage` menjadi String terlebih dahulu
	- Mengirim `wsMessage` ke `client` dengan `client.send()` 

#### Menjalankan Server
```javascript
const PORT = process.env.PORT || WSS_PORT;
const localIP = getLocalIP();

// jalankan server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`WebSocket Server Started`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Network: http://${localIP}:${PORT}`);
});
```
**Penjelasan:**
- Object `server` akan berjalan di alamat:
	1. localhost
	2. External IP
- Hostname `0.0.0.0` agar bisa menerima alamat manapun




# SCRIPT.JS

> Membuat Class AirConditionerMonitor {}
> 1. Bikin constructor nya
> 2. Menginisialisasi element
> 3. Membuat fungsi-fungsi
> 4. Panggil constructor nya pada Event Listener yang mendengarkan fungsi 'DOMContentLoaded'


# Setup
## Element Id
### Status Element
Element yang berfungsi untuk mendeskripsikan status MQTT apakah sudah terhubung atau belum.
- `status-text`
- `status-dot`
### Value Element
Element yang berfungsi untuk menampilkan data value dari sensor suhu DHT22.
- `temp-value`
- `humidity-value`
- `temp-graph` (optional)
- `humidity-value` (optional)
### Others
Element tambahan untuk penjelas ataupun sekadar dekorasi.
- 

> **Note:** 
> Ubah jadi camel case ketika mendefinisikan di script.js (ex. statusText)

## User Interaction
#### Variable
Variable untuk menyimpan input-an user:
- `topic-input` (String) - menerima input topic yang akan di-*subscribe* oleh user
#### Function
Fungsi yang akan dipanggil ketika user melakukan interaksi dengan website:
- `subscribeTopic()` - menghubungkan dengan Topic MQTT
- `unsubscribeTopic()` - memutus koneksi dengan MQTT
- `powerOn()` - menyalakan AC
- `powerOff()` - mematikan AC
- `tempUp()` - menaikkan suhu AC
- `tempDown()` - menurunkan suhu AC

## Function
Fungsi untuk fungsionalitas website.
- `connectBroker()`
- `reconnectBrokerAttempts()`
- `updateStatus(isOnline, statusText)`
- `handleMessage(message)`
- `updateData(data, timestamp)`
- `addLog(message)` (optional)
- `calculatePercentage(value, min, max)` (optional, kalau mau menambahkan fungsi `updateGraph()`)
- `updateGraph(graphElement, percentage, value, uint)` (optional)


# Building 
## Constructor
Constructor berfungsi untuk membangun class AirConditionerMonitor. Constructor berisi variable dan fungsi-fungsi. Variable yang diinisialisasi di constructor tidak boleh berasal dari sensor. Sedangkan untuk fungsi yang diinisialisasi di constructor hanya fungsi utama saja.

## Menginisialisasi Element
## Membuat Fungsi



# DESAIN
## Mobile Design
[Mobile Deisgn](./readme_images/mobile-design.png)

## Desktop Design
[Desktop Deisgn](./readme_images/desktop-design.png)