#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <IRremoteESP8266.h>
#include <IRrecv.h>
#include <IRsend.h>
#include <IRutils.h>
#include "DHT.h"
#include <ArduinoJson.h>

// Fitur Tambahan dari File 2
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ezButton.h>
#include <WebSocketsServer.h>


// ===========================
// KONFIGURASI OLED
// ===========================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define SDA_PIN 21
#define SCL_PIN 22
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);


// ===========================
// KONFIGURASI WIFI & MQTT
// ===========================
const char* ssid = "ramodale";
const char* password = "modalsitiklah";
const char* mqtt_broker = "34.29.231.210";
const int mqtt_port = 1883;
const char* mqtt_username = "esp32user";
const char* mqtt_password = "windows10";

WiFiClient espClient;
PubSubClient client(espClient);
Preferences preferences;


// ===========================
// KONFIGURASI WEBSOCKET
// ===========================
WebSocketsServer webSocket = WebSocketsServer(8080);


// ===========================
// KONFIGURASI PIN
// ===========================
#define RECV_PIN 34
#define IR_LED_PIN 27
#define DHTPIN 32
#define DHTTYPE DHT22
#define LED_PIN 2
#define BUTTON_PIN 4 

const uint16_t kCaptureBufferSize = 1024;
const uint8_t kTimeout = 50;


// ===========================
// OBJEK
// ===========================
IRrecv irrecv(RECV_PIN, kCaptureBufferSize, kTimeout, true);
IRsend irsend(IR_LED_PIN);
DHT dht(DHTPIN, DHTTYPE);
decode_results results;
ezButton button(BUTTON_PIN);


// ===========================
// STRUKTUR MULTI-DEVICE
// ===========================
struct ACDevice {
  String brand;
  String deviceId;
  decode_type_t protocol;
  bool hasData;
  int buttonCount;
};

struct TombolIR {
  String nama;
  uint16_t rawData[512];
  uint16_t length;
};


// ===========================
// MULTI-DEVICE STORAGE
// ===========================
const int MAX_DEVICES = 5;
const int MAX_BUTTONS_PER_DEVICE = 15; // Ditingkatkan sedikit untuk menampung suhu spesifik

ACDevice devices[MAX_DEVICES];
int totalDevices = 0;
int currentDeviceIndex = -1;

TombolIR currentDeviceButtons[MAX_BUTTONS_PER_DEVICE];


// ===========================
// STATE & TIMERS
// ===========================
bool powerStatus = false;
int currentTemp = 20; // Default start temp (tengah-tengah 18-22)

// Timers
unsigned long lastDataSend = 0;
const unsigned long DATA_SEND_INTERVAL = 10000;

unsigned long lastDisplayUpdate = 0;
const long displayUpdateInterval = 2000;

// Auto-record state (DIMODIFIKASI UNTUK 16-20 DERAJAT)
bool autoRecordMode = false;
// Array nama tombol yang akan direkam:
const char* autoRecordNames[7] = {
  "ON",         // Index 0
  "OFF",        // Index 1
  "TEMP_18",    // Index 2
  "TEMP_19",    // Index 3
  "TEMP_20",    // Index 4
  "TEMP_21",    // Index 5
  "TEMP_22"     // Index 6
};


// ===========================
// MQTT Topics
// ===========================
String mqttTopicData;
String mqttTopicCmd;
String mqttTopicStatus;


// ===========================
// FUNGSI OLED
// ===========================
void showOLEDMessage(const char* line1, const char* line2 = "", const char* line3 = "") {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  
  display.setCursor(0, 20);
  display.println(line1);
  
  if (strlen(line2) > 0) {
    display.setCursor(0, 30);
    display.println(line2);
  }
  
  if (strlen(line3) > 0) {
    display.setCursor(0, 40);
    display.println(line3);
  }
  
  display.display();
}

void updateOLEDDisplay(float temp, float hum) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);

  if (currentDeviceIndex >= 0) {
    display.print(devices[currentDeviceIndex].brand);
    display.print(" (");
    display.print(devices[currentDeviceIndex].buttonCount);
    display.println(" btn)");
  } else {
    display.println("No Device Active");
  }
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);
  
  display.setCursor(0, 15);
  display.print("Power: ");
  display.println(powerStatus ? "ON" : "OFF");
  
  display.setCursor(0, 25);
  display.print("AC Temp: ");
  display.print(currentTemp);
  display.println(" C");
  
  display.setCursor(0, 35);
  display.print("Room: ");
  display.print(temp, 1);
  display.println(" C");
  
  display.setCursor(0, 45);
  display.print("Humid: ");
  display.print(hum, 1);
  display.println(" %");
  
  display.setCursor(0, 55);
  if (WiFi.status() == WL_CONNECTED) display.print("WiFi:OK");
  else display.print("WiFi:Disc");
  
  display.setCursor(70, 55);
  if (client.connected()) display.print("MQTT:OK");
  else display.print("MQTT:Disc");
  
  display.display();
}


// ===========================
// Fungsi Deteksi Brand
// ===========================
String getBrandFromProtocol(decode_type_t protocol) {
  switch (protocol) {
    case COOLIX: return "coolix";
    case DAIKIN:
    case DAIKIN2:
    case DAIKIN216:
    case DAIKIN160: return "daikin";
    case MITSUBISHI_AC: return "mitsubishi";
    case SAMSUNG_AC: return "samsung";
    case LG:
    case LG2: return "lg";
    case SHARP:
    case SHARP_AC: return "sharp";
    case PANASONIC_AC: return "panasonic";
    case HITACHI_AC: return "hitachi";
    case FUJITSU_AC: return "fujitsu";
    case GREE: return "gree";
    default: return "unknown";
  }
}

String getDeviceIdFromProtocol(decode_type_t protocol) {
  return typeToString(protocol);
}


// ===========================
// PREFERENCES STORAGE FUNCTIONS
// ===========================
void saveDeviceList() {
  preferences.begin("ac-devices", false);
  preferences.putInt("totalDevices", totalDevices);

  for (int i = 0; i < totalDevices; i++) {
    String prefix = "dev" + String(i) + "_";
    preferences.putString((prefix + "brand").c_str(), devices[i].brand);
    preferences.putString((prefix + "id").c_str(), devices[i].deviceId);
    preferences.putInt((prefix + "protocol").c_str(), (int)devices[i].protocol);
    preferences.putInt((prefix + "btnCount").c_str(), devices[i].buttonCount);
  }

  preferences.end();
  Serial.println("✅ Device list saved to Preferences");
}

void loadDeviceList() {
  preferences.begin("ac-devices", true);
  totalDevices = preferences.getInt("totalDevices", 0);

  for (int i = 0; i < totalDevices; i++) {
    String prefix = "dev" + String(i) + "_";
    devices[i].brand = preferences.getString((prefix + "brand").c_str(), "");
    devices[i].deviceId = preferences.getString((prefix + "id").c_str(), "");
    devices[i].protocol = (decode_type_t)preferences.getInt((prefix + "protocol").c_str(), 0);
    devices[i].buttonCount = preferences.getInt((prefix + "btnCount").c_str(), 0);
    devices[i].hasData = devices[i].buttonCount > 0;
  }

  preferences.end();
  Serial.printf("✅ Loaded %d devices from Preferences\n", totalDevices);
}

void saveDeviceButtons(int deviceIndex) {
  if (deviceIndex < 0 || deviceIndex >= totalDevices) return;

  String namespace_name = "ac_" + String(deviceIndex);
  preferences.begin(namespace_name.c_str(), false);

  preferences.putInt("btnCount", devices[deviceIndex].buttonCount);

  for (int i = 0; i < devices[deviceIndex].buttonCount; i++) {
    String prefix = "btn" + String(i) + "_";
    preferences.putString((prefix + "name").c_str(), currentDeviceButtons[i].nama);
    preferences.putUShort((prefix + "len").c_str(), currentDeviceButtons[i].length);

    String dataKey = prefix + "data";
    preferences.putBytes(dataKey.c_str(), currentDeviceButtons[i].rawData,
                         currentDeviceButtons[i].length * sizeof(uint16_t));
  }

  preferences.end();
  Serial.printf("✅ Buttons saved for device %d\n", deviceIndex);
}

void loadDeviceButtons(int deviceIndex) {
  if (deviceIndex < 0 || deviceIndex >= totalDevices) return;

  String namespace_name = "ac_" + String(deviceIndex);
  preferences.begin(namespace_name.c_str(), true);

  int btnCount = preferences.getInt("btnCount", 0);
  devices[deviceIndex].buttonCount = btnCount; 

  for (int i = 0; i < btnCount && i < MAX_BUTTONS_PER_DEVICE; i++) {
    String prefix = "btn" + String(i) + "_";
    currentDeviceButtons[i].nama = preferences.getString((prefix + "name").c_str(), "");
    currentDeviceButtons[i].length = preferences.getUShort((prefix + "len").c_str(), 0);

    String dataKey = prefix + "data";
    preferences.getBytes(dataKey.c_str(), currentDeviceButtons[i].rawData,
                         currentDeviceButtons[i].length * sizeof(uint16_t));
  }

  preferences.end();
  Serial.printf("✅ Loaded %d buttons for device %d\n", btnCount, deviceIndex);
}


// ===========================
// DEVICE MANAGEMENT
// ===========================
int findDeviceByProtocol(decode_type_t protocol) {
  for (int i = 0; i < totalDevices; i++) {
    if (devices[i].protocol == protocol) {
      return i;
    }
  }
  return -1;
}

int addNewDevice(decode_type_t protocol) {
  if (totalDevices >= MAX_DEVICES) {
    Serial.println("⚠️ Maximum devices reached!");
    showOLEDMessage("Error", "Max devices", "reached!");
    delay(1500);
    return -1;
  }

  String brand = getBrandFromProtocol(protocol);
  String deviceId = getDeviceIdFromProtocol(protocol);

  devices[totalDevices].brand = brand;
  devices[totalDevices].deviceId = deviceId;
  devices[totalDevices].protocol = protocol;
  devices[totalDevices].buttonCount = 0;
  devices[totalDevices].hasData = false;

  int newIndex = totalDevices;
  totalDevices++;

  saveDeviceList();

  Serial.printf("✅ New device added: %s/%s (index: %d)\n", brand.c_str(), deviceId.c_str(), newIndex);
  return newIndex;
}

void switchToDevice(int deviceIndex) {
  if (deviceIndex < 0 || deviceIndex >= totalDevices) {
    Serial.println("❌ Invalid device index");
    return;
  }

  if (currentDeviceIndex >= 0) {
    saveDeviceButtons(currentDeviceIndex);
  }

  currentDeviceIndex = deviceIndex;
  loadDeviceButtons(deviceIndex);

  mqttTopicData = "ac/" + devices[deviceIndex].brand + "/" + devices[deviceIndex].deviceId + "/data";
  mqttTopicCmd = "ac/" + devices[deviceIndex].brand + "/" + devices[deviceIndex].deviceId + "/cmd";
  mqttTopicStatus = "ac/" + devices[deviceIndex].brand + "/" + devices[deviceIndex].deviceId + "/status";

  if (client.connected()) {
    client.unsubscribe("#"); 
    client.subscribe(mqttTopicCmd.c_str());
    Serial.printf("🟢 Subscribed to: %s\n", mqttTopicCmd.c_str());
  }

  Serial.printf("✅ Switched to device: %s/%s\n",
                devices[deviceIndex].brand.c_str(),
                devices[deviceIndex].deviceId.c_str());
  showOLEDMessage("Device Active", devices[deviceIndex].brand.c_str(), "");
  delay(1500);
  
  // Reset status
  powerStatus = false;
  currentTemp = 18; // Reset ke tengah range
  digitalWrite(LED_PIN, LOW);
}


// ===========================
// WiFi & MQTT Functions
// ===========================
void setupWiFi() {
  Serial.print("🔌 Menghubungkan ke WiFi ");
  Serial.println(ssid);
  showOLEDMessage("Connecting WiFi...", ssid, "");

  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi Terhubung!");
    Serial.print("📡 IP Address: ");
    Serial.println(WiFi.localIP());
    showOLEDMessage("WiFi Connected!", WiFi.localIP().toString().c_str(), "");
    delay(1500);
  } else {
    Serial.println("\n❌ WiFi Gagal!");
    showOLEDMessage("WiFi Failed!", "", "");
    delay(1500);
  }
}

// Deklarasi handleCommand
void handleCommand(String command, int temp);

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.printf("📩 Message from topic: %s\n", topic);

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, payload, length);

  if (error) {
    Serial.println("❌ JSON parse error");
    return;
  }

  String command = doc["command"] | "";
  int temp = doc["temperature"] | 25;

  Serial.printf("Command: %s, Temp: %d\n", command.c_str(), temp);
  handleCommand(command, temp);
}

void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("🔗 Menghubungkan ke MQTT...");
    showOLEDMessage("Connecting MQTT...", mqtt_broker, "");

    String clientId = "ESP32_AC_";
    if (currentDeviceIndex >= 0) {
      clientId += devices[currentDeviceIndex].deviceId;
    } else {
      clientId += String(random(0xffff), HEX);
    }

    if (client.connect(clientId.c_str(), mqtt_username, mqtt_password)) {
      Serial.println("✅ Terhubung ke broker!");
      showOLEDMessage("MQTT Connected!", "", "");
      delay(1500);

      if (currentDeviceIndex >= 0) {
        client.subscribe(mqttTopicCmd.c_str());
        Serial.printf("🟢 Subscribed to: %s\n", mqttTopicCmd.c_str());
      }
    } else {
      Serial.print("❌ Gagal (rc=");
      Serial.print(client.state());
      Serial.println("), mencoba lagi dalam 5 detik...");
      showOLEDMessage("MQTT Failed!", "Retrying...", "");
      delay(5000);
    }
  }
}


// ===========================
// FUNGSI WEBSOCKET
// ===========================
void onWebSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    Serial.printf("🌐 Client %u terhubung ke WebSocket.\n", num);
    webSocket.sendTXT(num, "Connected to ESP32 WebSocket!");
  } 
  else if (type == WStype_DISCONNECTED) {
    Serial.printf("❌ Client %u terputus.\n", num);
  } 
  else if (type == WStype_TEXT) {
    String msg = String((char*)payload);
    Serial.printf("📩 WebSocket msg: %s\n", msg.c_str());

    if (msg == "toggle_power") {
      if (powerStatus) {
        handleCommand("OFF", currentTemp);
      } else {
        handleCommand("ON", currentTemp);
      }
    } else if (msg == "TEMP_UP") {
      handleCommand("TEMP_UP", currentTemp);
    } else if (msg == "TEMP_DOWN") {
      handleCommand("TEMP_DOWN", currentTemp);
    } else if (msg == "read_dht") {
      sendSensorData(); 
    }
  }
}


// ===========================
// COMMAND HANDLER (DIMODIFIKASI LOGIKANYA)
// ===========================
void sendIRButton(int btnIndex) {
  if (currentDeviceIndex < 0 || btnIndex < 0 || btnIndex >= devices[currentDeviceIndex].buttonCount) {
    Serial.println("❌ Invalid button index");
    return;
  }

  TombolIR& btn = currentDeviceButtons[btnIndex];

  irrecv.disableIRIn();
  for (int i = 0; i < 3; i++) {
    irsend.sendRaw(btn.rawData, btn.length, 38);
    delay(200);
  }
  irrecv.enableIRIn();

  Serial.printf("📤 IR signal sent: %s\n", btn.nama.c_str());
}

void sendCommandStatus(String command, bool success) {
  if (currentDeviceIndex < 0) return;

  StaticJsonDocument<256> doc;
  doc["type"] = "perintah_status";
  doc["command"] = command;
  doc["status"] = success ? "success" : "failed";
  doc["power_status"] = powerStatus;
  doc["current_temp"] = currentTemp;
  doc["timestamp"] = millis();

  char buffer[256];
  serializeJson(doc, buffer);

  client.publish(mqttTopicStatus.c_str(), buffer, true);
  webSocket.broadcastTXT(buffer);
  
  Serial.printf("📤 Status sent: %s\n", buffer);
}

void handleCommand(String command, int temp) {
  if (currentDeviceIndex < 0) {
    Serial.println("⚠️ No device selected");
    showOLEDMessage("Error", "No device", "selected!");
    delay(1500);
    return;
  }

  bool success = false;
  String oledMsg1 = "";
  String oledMsg2 = "";

  /* MAPPING INDEX:
     0: ON
     1: OFF
     2: TEMP_18
     3: TEMP_19
     4: TEMP_20
     5: TEMP_21
     6: TEMP_22
  */

  if (command == "ON") {
    if (devices[currentDeviceIndex].buttonCount > 0) {
      powerStatus = true;
      // Jangan reset temp ke 25, biarkan temp terakhir atau default 20
      if (currentTemp < 18 || currentTemp > 22) currentTemp = 20; 
      digitalWrite(LED_PIN, HIGH);
      sendIRButton(0); // Kirim sinyal ON
      success = true;
      oledMsg1 = "AC ON";
      oledMsg2 = "Temp: " + String(currentTemp) + " C";
    }
  } else if (command == "OFF") {
    if (devices[currentDeviceIndex].buttonCount > 1) {
      powerStatus = false;
      digitalWrite(LED_PIN, LOW);
      sendIRButton(1); // Kirim sinyal OFF
      success = true;
      oledMsg1 = "AC OFF";
    }
  } else if (command == "TEMP_UP" && powerStatus) {
    // Batas Max sekarang 22
    if (currentTemp < 22) {
      currentTemp++;
      int btnIndex = (currentTemp - 18) + 2;

      if (devices[currentDeviceIndex].buttonCount > btnIndex) {
        sendIRButton(btnIndex);
        success = true;
        oledMsg1 = "Temp UP";
        oledMsg2 = "Now: " + String(currentTemp) + " C";
      }
    } else {
        oledMsg1 = "Max Temp";
        oledMsg2 = "Limit: 22 C";
        showOLEDMessage(oledMsg1.c_str(), oledMsg2.c_str(), "");
        delay(1000);
    }
  } else if (command == "TEMP_DOWN" && powerStatus) {
    // Batas Min sekarang 18
    if (currentTemp > 18) {
      currentTemp--;
      
      // Rumus sama: Index = (Suhu - 16) + 2
      int btnIndex = (currentTemp - 18) + 2;

      if (devices[currentDeviceIndex].buttonCount > btnIndex) {
        sendIRButton(btnIndex);
        success = true;
        oledMsg1 = "Temp DOWN";
        oledMsg2 = "Now: " + String(currentTemp) + " C";
      }
    } else {
        oledMsg1 = "Min Temp";
        oledMsg2 = "Limit: 18 C";
        showOLEDMessage(oledMsg1.c_str(), oledMsg2.c_str(), "");
        delay(1000);
    }
  }

  if (success) {
    showOLEDMessage(oledMsg1.c_str(), oledMsg2.c_str(), "");
    delay(1000);
  }

  sendCommandStatus(command, success);
}


// ===========================
// SENSOR & DATA SENDER
// ===========================
void sendSensorData() {
  if (currentDeviceIndex < 0) return;

  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (isnan(t) || isnan(h)) {
    Serial.println("❌ Failed to read DHT22");
    return;
  }

  StaticJsonDocument<512> doc;
  doc["type"] = "data";
  doc["temperature"] = t;
  doc["humidity"] = h;
  doc["power_status"] = powerStatus;
  doc["current_temp"] = currentTemp;
  doc["timestamp"] = millis();

  char buffer[512];
  serializeJson(doc, buffer);

  client.publish(mqttTopicData.c_str(), buffer);
  webSocket.broadcastTXT(buffer);
  
  if (!autoRecordMode) {
    updateOLEDDisplay(t, h);
  }

  Serial.printf("📤 Data sent (MQTT/WS/OLED): T=%.1f°C, H=%.1f%%\n", t, h);
}


// ===========================
// IR RECORDING (Manual)
// ===========================
void recordIRButton() {
  if (currentDeviceIndex < 0) {
    Serial.println("⚠️ No device selected! Create device first.");
    showOLEDMessage("Error", "No device", "selected!");
    delay(1500);
    return;
  }

  if (devices[currentDeviceIndex].buttonCount >= MAX_BUTTONS_PER_DEVICE) {
    Serial.println("⚠️ Maximum buttons reached for this device!");
    showOLEDMessage("Error", "Button memory", "full!");
    delay(1500);
    return;
  }
  
  int btnIndex = devices[currentDeviceIndex].buttonCount;
  String msg = "Record button #" + String(btnIndex + 1);
  Serial.printf("\n📡 %s for %s/%s\n", msg.c_str(),
                devices[currentDeviceIndex].brand.c_str(),
                devices[currentDeviceIndex].deviceId.c_str());
  Serial.println("Point remote and press button...");
  showOLEDMessage("Manual Record", msg.c_str(), "Press remote...");

  while (!irrecv.decode(&results)) {
    delay(100);
  }

  TombolIR& btn = currentDeviceButtons[btnIndex];
  btn.length = min(results.rawlen - 1, 512);

  Serial.print("Enter button name (e.g., ON, OFF, FAN): ");
  while (!Serial.available()) delay(10);
  btn.nama = Serial.readStringUntil('\n');
  btn.nama.trim();

  for (uint16_t i = 1; i <= btn.length; i++) {
    btn.rawData[i - 1] = results.rawbuf[i] * kRawTick;
  }

  devices[currentDeviceIndex].buttonCount++;
  devices[currentDeviceIndex].hasData = true;

  saveDeviceButtons(currentDeviceIndex);
  saveDeviceList();

  Serial.printf("✅ Button '%s' saved (length: %d)\n", btn.nama.c_str(), btn.length);
  showOLEDMessage("Button Saved!", btn.nama.c_str(), "");
  delay(1500);

  irrecv.resume();
}


// ===========================
// FUNGSI AUTO RECORD (DIMODIFIKASI: 7 TOMBOL)
// ===========================
void autoRecordIR() {
  if (currentDeviceIndex < 0) {
    Serial.println("⚠️ No device selected! Cannot auto-record.");
    showOLEDMessage("Error", "Select device", "before auto-record");
    delay(2000);
    return;
  }
  
  Serial.println("\n╔════════════════════════════════════╗");
  Serial.println("║   AUTO RECORD MODE (7 Buttons)     ║");
  Serial.println("╚════════════════════════════════════╝");
  Serial.printf("Device: %s/%s\n", devices[currentDeviceIndex].brand.c_str(), devices[currentDeviceIndex].deviceId.c_str());
  Serial.println("Akan merekam urutan:");
  Serial.println("1. ON");
  Serial.println("2. OFF");
  Serial.println("3. TEMP 18 C");
  Serial.println("4. TEMP 19 C");
  Serial.println("5. TEMP 20 C");
  Serial.println("6. TEMP 21 C");
  Serial.println("7. TEMP 22 C");
  
  showOLEDMessage("Auto Record Mode", "Buttons: 7", "Range: 18-22C");
  delay(2000);
  
  autoRecordMode = true;
  
  // Reset jumlah tombol untuk device ini agar tertimpa dari awal
  devices[currentDeviceIndex].buttonCount = 0; 
  int savedCount = 0;
  
  // Loop sekarang 7 kali
  for (int i = 0; i < 7; i++) {
    const char* buttonName = autoRecordNames[i];
    
    Serial.printf("\n[%d/7] Recording: %s\n", i+1, buttonName);
    Serial.println("Press remote button within 5 seconds...");
    
    // Tampilkan di OLED
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 10);
    display.println("Auto Record");
    display.drawLine(0, 20, 128, 20, SSD1306_WHITE);
    display.setCursor(0, 25);
    display.printf("Step: %d/7\n", i+1);
    display.setCursor(0, 35);
    display.printf("Recording:\n%s", buttonName);
    display.setCursor(0, 55);
    display.println("Press remote...");
    display.display();
    
    unsigned long startTime = millis();
    bool received = false;
    
    while (millis() - startTime < 5000) {  // 5 detik timeout
      if (irrecv.decode(&results)) {
        received = true;
        break;
      }
      delay(10);
    }
    
    if (!received) {
      Serial.printf("❌ Timeout! No signal received for %s\n", buttonName);
      showOLEDMessage("Timeout!", buttonName, "Skipped");
      delay(1500);
      continue;
    }
    
    int btnIndex = devices[currentDeviceIndex].buttonCount;
    TombolIR &btn = currentDeviceButtons[btnIndex];
    
    btn.nama = buttonName;
    btn.length = min((int)(results.rawlen - 1), 512);
    
    for (uint16_t j = 1; j <= btn.length; j++) {
      btn.rawData[j - 1] = results.rawbuf[j] * kRawTick;
    }
    
    devices[currentDeviceIndex].buttonCount++;
    savedCount++;
    
    Serial.printf("✅ %s saved!\n", buttonName);
    
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 15);
    display.printf("Saved: %s", buttonName);
    display.setCursor(0, 30);
    display.printf("Step %d/7 OK!", i+1);
    display.display();
    
    irrecv.resume();
    delay(1000);
  }
  
  if (savedCount > 0) {
    devices[currentDeviceIndex].hasData = true;
    saveDeviceButtons(currentDeviceIndex);
    saveDeviceList();
  }
  
  autoRecordMode = false;
  
  Serial.println("\n╔════════════════════════════════════╗");
  Serial.printf("║  AUTO RECORD COMPLETE: %d/7 buttons ║\n", savedCount);
  Serial.println("╚════════════════════════════════════╝\n");
  
  showOLEDMessage("Auto Record", "Complete!", ("Saved: " + String(savedCount) + "/7").c_str());
  delay(2000);
}


// ===========================
// Device Creation
// ===========================
void createNewDevice() {
  Serial.println("\n📡 Point remote and press ANY button to detect device...");
  showOLEDMessage("Create Device", "Press ANY button", "on remote...");
  
  while (!irrecv.decode(&results)) {
    delay(100);
  }

  decode_type_t protocol = results.decode_type;
  String brand = getBrandFromProtocol(protocol);
  Serial.printf("Detected protocol: %s (%s)\n", typeToString(protocol).c_str(), brand.c_str());
  showOLEDMessage("Detected:", brand.c_str(), typeToString(protocol).c_str());
  delay(2000);

  int existingIndex = findDeviceByProtocol(protocol);
  if (existingIndex >= 0) {
    Serial.printf("⚠️ Device already exists at index %d\n", existingIndex);
    switchToDevice(existingIndex);
  } else {
    int newIndex = addNewDevice(protocol);
    if (newIndex >= 0) {
      switchToDevice(newIndex);
    }
  }

  irrecv.resume();
}


// ===========================
// MENU FUNCTIONS
// ===========================
void printMenu() {
  Serial.println("\n╔════════════════════════════════════╗");
  Serial.println("║   ESP32 Multi-AC Control + OLED   ║");
  Serial.println("╚════════════════════════════════════╝");
  Serial.println("[1] Create/Detect New Device");
  Serial.println("[2] List All Devices");
  Serial.println("[3] Switch Device");
  Serial.println("[4] Record IR Button (Manual)");
  Serial.println("[5] List Buttons (Current Device)");
  Serial.println("[6] Send Test IR");
  Serial.println("[7] Read & Send DHT22 Data");
  Serial.println("[8] Clear All Data");
  Serial.println("[9] Auto-Record 7 Buttons (18-22C)");
  Serial.println("\n[BUTTON GPIO4] Auto-Record 7 Buttons");
  Serial.println();

  if (currentDeviceIndex >= 0) {
    Serial.printf("Current Device: %s/%s (%d buttons)\n",
                  devices[currentDeviceIndex].brand.c_str(),
                  devices[currentDeviceIndex].deviceId.c_str(),
                  devices[currentDeviceIndex].buttonCount);
  } else {
    Serial.println("Current Device: None");
  }
  Serial.println();
}

void listAllDevices() {
  Serial.println("\n📱 REGISTERED DEVICES:");
  if (totalDevices == 0) {
    Serial.println("No devices registered yet.");
    return;
  }

  for (int i = 0; i < totalDevices; i++) {
    Serial.printf("[%d] %s/%s - %d buttons %s\n",
                  i,
                  devices[i].brand.c_str(),
                  devices[i].deviceId.c_str(),
                  devices[i].buttonCount,
                  (i == currentDeviceIndex) ? "(ACTIVE)" : "");
  }
}

void listCurrentButtons() {
  if (currentDeviceIndex < 0) {
    Serial.println("⚠️ No device selected");
    return;
  }

  Serial.printf("\n🔘 BUTTONS FOR %s/%s:\n",
                devices[currentDeviceIndex].brand.c_str(),
                devices[currentDeviceIndex].deviceId.c_str());

  if (devices[currentDeviceIndex].buttonCount == 0) {
    Serial.println("No buttons recorded yet.");
    return;
  }

  for (int i = 0; i < devices[currentDeviceIndex].buttonCount; i++) {
    Serial.printf("[%d] %s (len: %d)\n",
                  i,
                  currentDeviceButtons[i].nama.c_str(),
                  currentDeviceButtons[i].length);
  }
}

void switchDeviceMenu() {
  listAllDevices();
  Serial.print("\nEnter device number: ");
  while (!Serial.available()) delay(10);
  int idx = Serial.readStringUntil('\n').toInt();

  if (idx >= 0 && idx < totalDevices) {
    switchToDevice(idx);
  } else {
    Serial.println("❌ Invalid device number");
  }
}

void sendTestIR() {
  if (currentDeviceIndex < 0 || devices[currentDeviceIndex].buttonCount == 0) {
    Serial.println("⚠️ No buttons available");
    return;
  }

  Serial.println("\nSelect button to send:");
  listCurrentButtons();

  Serial.print("Enter button number: ");
  while (!Serial.available()) delay(10);
  int idx = Serial.readStringUntil('\n').toInt();

  if (idx >= 0 && idx < devices[currentDeviceIndex].buttonCount) {
    sendIRButton(idx);
  } else {
    Serial.println("❌ Invalid button number");
  }
}

void clearAllData() {
  Serial.print("⚠️  Clear ALL data? (y/n): ");
  showOLEDMessage("Clear All Data?", "Press 'y' in Serial", "");
  while (!Serial.available()) delay(10);
  String confirm = Serial.readStringUntil('\n');
  confirm.trim();

  if (confirm == "y" || confirm == "Y") {
    preferences.begin("ac-devices", false);
    preferences.clear();
    preferences.end();

    for (int i = 0; i < totalDevices; i++) {
      String ns = "ac_" + String(i);
      preferences.begin(ns.c_str(), false);
      preferences.clear();
      preferences.end();
    }

    totalDevices = 0;
    currentDeviceIndex = -1;

    Serial.println("✅ All data cleared!");
    showOLEDMessage("All Data Cleared!", "Restarting...", "");
    delay(2000);
    ESP.restart();
  } else {
    Serial.println("Cancelled.");
    showOLEDMessage("Cancelled", "", "");
    delay(1000);
  }
}


// ===========================
// SETUP
// ===========================
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  button.setDebounceTime(50);

  Wire.begin(SDA_PIN, SCL_PIN);
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("❌ SSD1306 allocation failed"));
    while(1);
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("ESP32 AC Remote");
  display.println("Initializing...");
  display.display();
  delay(1000);

  loadDeviceList();

  setupWiFi();

  client.setServer(mqtt_broker, mqtt_port);
  client.setCallback(mqttCallback);
  reconnectMQTT();

  dht.begin();
  irsend.begin();
  irrecv.enableIRIn();

  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);

  if (totalDevices > 0 && currentDeviceIndex == -1) {
    switchToDevice(0);
  } else {
    showOLEDMessage("System Ready!", "No device active.", "Use menu [1] or [3]");
    delay(2000);
  }

  printMenu();
}


// ===========================
// LOOP
// ===========================
void loop() {
  button.loop();
  if (button.isPressed() && !autoRecordMode) {
    Serial.println("\n🔘 Button pressed! Starting auto-record...");
    autoRecordIR();
    printMenu(); 
  }
  
  if (!client.connected()) reconnectMQTT();
  client.loop();
  webSocket.loop();

  unsigned long now = millis();
  
  if (currentDeviceIndex >= 0 && now - lastDataSend > DATA_SEND_INTERVAL) {
    sendSensorData();
    lastDataSend = now;
  }
  
  if (!autoRecordMode && now - lastDisplayUpdate > displayUpdateInterval) {
    lastDisplayUpdate = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) {
      updateOLEDDisplay(t, h);
    }
  }

  if (Serial.available()) {
    char cmd = Serial.readStringUntil('\n')[0];
    switch (cmd) {
      case '1': createNewDevice(); break;
      case '2': listAllDevices(); break;
      case '3': switchDeviceMenu(); break;
      case '4': recordIRButton(); break;
      case '5': listCurrentButtons(); break;
      case '6': sendTestIR(); break;
      case '7': sendSensorData(); break;
      case '8': clearAllData(); break;
      case '9': autoRecordIR(); break;
      default: Serial.println("❌ Invalid option"); break;
    }
    printMenu();
  }
}