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

// ===========================
// KONFIGURASI WIFI & MQTT
// ===========================
const char* ssid = "han";
const char* password = "hahan123";

const char* mqtt_broker = "35.226.15.168";
const int mqtt_port = 1883;
const char* mqtt_username = "esp32user";
const char* mqtt_password = "windows10";

WiFiClient espClient;
PubSubClient client(espClient);
Preferences preferences;

// ===========================
// KONFIGURASI PIN
// ===========================
#define RECV_PIN 34
#define IR_LED_PIN 27
#define DHTPIN 32
#define DHTTYPE DHT22
#define LED_PIN 2

const uint16_t kCaptureBufferSize = 1024;
const uint8_t kTimeout = 50;

// ===========================
// OBJEK
// ===========================
IRrecv irrecv(RECV_PIN, kCaptureBufferSize, kTimeout, true);
IRsend irsend(IR_LED_PIN);
DHT dht(DHTPIN, DHTTYPE);
decode_results results;

// ===========================
// STRUKTUR MULTI-DEVICE
// ===========================
struct ACDevice {
  String brand;           // Nama brand AC (dari protocol)
  String deviceId;        // ID unik dari protocol
  decode_type_t protocol; // Protocol IR
  bool hasData;           // Flag apakah device punya data
  int buttonCount;        // Jumlah tombol tersimpan
};

struct TombolIR {
  String nama;
  uint16_t rawData[512];  // Dikurangi untuk hemat memori per device
  uint16_t length;
};

// ===========================
// MULTI-DEVICE STORAGE
// ===========================
const int MAX_DEVICES = 5;
const int MAX_BUTTONS_PER_DEVICE = 10;

ACDevice devices[MAX_DEVICES];
int totalDevices = 0;
int currentDeviceIndex = -1;

// Temporary storage untuk tombol device yang sedang aktif
TombolIR currentDeviceButtons[MAX_BUTTONS_PER_DEVICE];

// State variables
bool powerStatus = false;
int currentTemp = 25;
unsigned long lastDataSend = 0;
const unsigned long DATA_SEND_INTERVAL = 10000; // Kirim data tiap 10 detik

// ===========================
// MQTT Topics (Dynamic)
// ===========================
String mqttTopicData;
String mqttTopicCmd;
String mqttTopicStatus;

// ===========================
// Fungsi Deteksi Brand dari Protocol
// ===========================
String getBrandFromProtocol(decode_type_t protocol) {
  switch (protocol) {
    case COOLIX: return "coolix";
    case DAIKIN: case DAIKIN2: case DAIKIN216: case DAIKIN160: return "daikin";
    case MITSUBISHI_AC: return "mitsubishi";
    case SAMSUNG_AC: return "samsung";
    case LG: case LG2: return "lg";
    case SHARP: case SHARP_AC: return "sharp";
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
    
    // Save raw data in chunks
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
  
  // Save current device buttons if needed
  if (currentDeviceIndex >= 0) {
    saveDeviceButtons(currentDeviceIndex);
  }
  
  currentDeviceIndex = deviceIndex;
  loadDeviceButtons(deviceIndex);
  
  // Update MQTT topics
  mqttTopicData = "ac/" + devices[deviceIndex].brand + "/" + devices[deviceIndex].deviceId + "/data";
  mqttTopicCmd = "ac/" + devices[deviceIndex].brand + "/" + devices[deviceIndex].deviceId + "/cmd";
  mqttTopicStatus = "ac/" + devices[deviceIndex].brand + "/" + devices[deviceIndex].deviceId + "/status";
  
  // Subscribe to command topic
  if (client.connected()) {
    client.unsubscribe("#");
    client.subscribe(mqttTopicCmd.c_str());
    Serial.printf("🟢 Subscribed to: %s\n", mqttTopicCmd.c_str());
  }
  
  Serial.printf("✅ Switched to device: %s/%s\n", 
                devices[deviceIndex].brand.c_str(), 
                devices[deviceIndex].deviceId.c_str());
}

// ===========================
// WiFi & MQTT Functions
// ===========================
void setupWiFi() {
  Serial.print("🔌 Menghubungkan ke WiFi ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi Terhubung!");
  Serial.print("📡 IP Address: ");
  Serial.println(WiFi.localIP());
}

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
    
    String clientId = "ESP32_AC_";
    if (currentDeviceIndex >= 0) {
      clientId += devices[currentDeviceIndex].deviceId;
    } else {
      clientId += String(random(0xffff), HEX);
    }
    
    if (client.connect(clientId.c_str(), mqtt_username, mqtt_password)) {
      Serial.println("✅ Terhubung ke broker!");
      
      if (currentDeviceIndex >= 0) {
        client.subscribe(mqttTopicCmd.c_str());
        Serial.printf("🟢 Subscribed to: %s\n", mqttTopicCmd.c_str());
      }
    } else {
      Serial.print("❌ Gagal (rc=");
      Serial.print(client.state());
      Serial.println("), mencoba lagi dalam 5 detik...");
      delay(5000);
    }
  }
}

// ===========================
// COMMAND HANDLER
// ===========================
void handleCommand(String command, int temp) {
  if (currentDeviceIndex < 0) {
    Serial.println("⚠️ No device selected");
    return;
  }
  
  bool success = false;
  
  if (command == "ON") {
    powerStatus = true;
    currentTemp = 25;
    digitalWrite(LED_PIN, HIGH);
    success = true;
    
    // Send IR signal for ON button (index 0)
    if (devices[currentDeviceIndex].buttonCount > 0) {
      sendIRButton(0);
    }
  }
  else if (command == "OFF") {
    powerStatus = false;
    digitalWrite(LED_PIN, LOW);
    success = true;
    
    // Send IR signal for OFF button (index 1 if exists, else 0)
    int btnIndex = devices[currentDeviceIndex].buttonCount > 1 ? 1 : 0;
    if (devices[currentDeviceIndex].buttonCount > 0) {
      sendIRButton(btnIndex);
    }
  }
  else if (command == "TEMP_UP" && powerStatus) {
    if (currentTemp < 30) {
      currentTemp++;
      success = true;
      
      // Send IR signal for TEMP_UP button (index 2)
      if (devices[currentDeviceIndex].buttonCount > 2) {
        sendIRButton(2);
      }
    }
  }
  else if (command == "TEMP_DOWN" && powerStatus) {
    if (currentTemp > 16) {
      currentTemp--;
      success = true;
      
      // Send IR signal for TEMP_DOWN button (index 3)
      if (devices[currentDeviceIndex].buttonCount > 3) {
        sendIRButton(3);
      }
    }
  }
  
  // Send status back
  sendCommandStatus(command, success);
}

void sendIRButton(int btnIndex) {
  if (btnIndex < 0 || btnIndex >= devices[currentDeviceIndex].buttonCount) {
    Serial.println("❌ Invalid button index");
    return;
  }
  
  TombolIR &btn = currentDeviceButtons[btnIndex];
  
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
  Serial.printf("📤 Status sent: %s\n", buffer);
}

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
  Serial.printf("📤 Data sent: T=%.1f°C, H=%.1f%%\n", t, h);
}

// ===========================
// IR RECORDING
// ===========================
void recordIRButton() {
  if (currentDeviceIndex < 0) {
    Serial.println("⚠️ No device selected! Create device first.");
    return;
  }
  
  if (devices[currentDeviceIndex].buttonCount >= MAX_BUTTONS_PER_DEVICE) {
    Serial.println("⚠️ Maximum buttons reached for this device!");
    return;
  }
  
  Serial.printf("\n📡 Recording button #%d for %s/%s\n", 
                devices[currentDeviceIndex].buttonCount + 1,
                devices[currentDeviceIndex].brand.c_str(),
                devices[currentDeviceIndex].deviceId.c_str());
  Serial.println("Point remote and press button...");
  
  while (!irrecv.decode(&results)) {
    delay(100);
  }
  
  int btnIndex = devices[currentDeviceIndex].buttonCount;
  TombolIR &btn = currentDeviceButtons[btnIndex];
  
  btn.length = min(results.rawlen - 1, 512);
  
  Serial.print("Enter button name (ON/OFF/TEMP_UP/TEMP_DOWN): ");
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
  
  irrecv.resume();
}

void createNewDevice() {
  Serial.println("\n📡 Point remote and press ANY button to detect device...");
  
  while (!irrecv.decode(&results)) {
    delay(100);
  }
  
  decode_type_t protocol = results.decode_type;
  Serial.printf("Detected protocol: %s\n", typeToString(protocol).c_str());
  
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
  Serial.println("║   ESP32 Multi-Device AC Control   ║");
  Serial.println("╚════════════════════════════════════╝");
  Serial.println("[1] Create/Detect New Device");
  Serial.println("[2] List All Devices");
  Serial.println("[3] Switch Device");
  Serial.println("[4] Record IR Button (Current Device)");
  Serial.println("[5] List Buttons (Current Device)");
  Serial.println("[6] Send Test IR");
  Serial.println("[7] Read & Send DHT22 Data");
  Serial.println("[8] Clear All Data");
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
    ESP.restart();
  } else {
    Serial.println("Cancelled.");
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

  // Load devices from Preferences
  loadDeviceList();

  setupWiFi();
  client.setServer(mqtt_broker, mqtt_port);
  client.setCallback(mqttCallback);
  reconnectMQTT();

  dht.begin();
  irsend.begin();
  irrecv.enableIRIn();

  // Auto-select first device if available
  if (totalDevices > 0) {
    switchToDevice(0);
  }

  printMenu();
}

// ===========================
// LOOP
// ===========================
void loop() {
  if (!client.connected()) reconnectMQTT();
  client.loop();

  // Auto-send sensor data
  if (currentDeviceIndex >= 0 && millis() - lastDataSend > DATA_SEND_INTERVAL) {
    sendSensorData();
    lastDataSend = millis();
  }

  // Serial menu
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
      default: Serial.println("❌ Invalid option"); break;
    }
    printMenu();
  }
}
