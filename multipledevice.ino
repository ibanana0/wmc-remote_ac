#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <IRremoteESP8266.h>
#include <IRrecv.h>
#include <IRac.h>
#include <IRutils.h>
#include "DHT.h"
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ===========================
// KONFIGURASI
// ===========================
// WiFi & MQTT
const char* ssid = "Kentaki";
const char* password = "ayamkentakienak";

const char* mqtt_broker = "136.119.220.130";
const int mqtt_port = 1883;
const char* mqtt_username = "esp32user";
const char* mqtt_password = "windows10";

// Pin Configuration
#define RECV_PIN 34
#define IR_LED_PIN 27
#define DHTPIN 32
#define DHTTYPE DHT22
#define LED_PIN 2
#define SDA_PIN 21
#define SCL_PIN 22
#define BUTTON_PIN 4  // <--- PIN TOMBOL FISIK

// OLED
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1

// IR Settings
const uint16_t kCaptureBufferSize = 1024;
const uint8_t kTimeout = 50;
const uint8_t kTolerance = 25; // Toleransi sinyal IR

// ===========================
// OBJEK
// ===========================
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
WiFiClient espClient;
PubSubClient client(espClient);
Preferences preferences;
IRrecv irrecv(RECV_PIN, kCaptureBufferSize, kTimeout, true);
IRac ac(IR_LED_PIN);
DHT dht(DHTPIN, DHTTYPE);
decode_results results;

// ===========================
// VARIABEL STATE
// ===========================
decode_type_t currentProtocol = decode_type_t::UNKNOWN;
String currentBrand = "none";
bool powerStatus = false;
int currentTemp = 25;
stdAc::opmode_t currentMode = stdAc::opmode_t::kCool;

unsigned long lastDataSend = 0;
unsigned long lastDisplayUpdate = 0;
const unsigned long DATA_SEND_INTERVAL = 10000;
const unsigned long DISPLAY_UPDATE_INTERVAL = 2000;

String mqttTopicData = "ac/data";
String mqttTopicCmd = "ac/cmd";
String mqttTopicStatus = "ac/status";

// Forward declarations
void showMessage(const char* line1, const char* line2 = "", const char* line3 = "");
String typeToString(decode_type_t protocol); // Helper dari library IRremoteESP8266
void configureAC();
void handleCommand(String cmd, int temp);

// ===========================
// FUNGSI OLED
// ===========================
void showMessage(const char* line1, const char* line2, const char* line3) {
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

void updateDisplay(float temp, float hum) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  
  // Header - Device info
  display.setCursor(0, 0);
  if (currentProtocol != decode_type_t::UNKNOWN) {
    display.print(currentBrand);
    display.print(" (");
    display.print(typeToString(currentProtocol));
    display.println(")");
  } else {
    display.println("No AC Detected");
  }
  display.drawLine(0, 10, 128, 10, SSD1306_WHITE);
  
  // AC State
  display.setCursor(0, 15);
  display.print("Power: ");
  display.println(powerStatus ? "ON" : "OFF");
  
  display.setCursor(0, 25);
  display.print("Temp: ");
  display.print(currentTemp);
  display.print("C  Mode:");
  if (currentMode == stdAc::opmode_t::kCool) display.println("COOL");
  else if (currentMode == stdAc::opmode_t::kHeat) display.println("HEAT");
  else if (currentMode == stdAc::opmode_t::kDry) display.println("DRY");
  else display.println("FAN");
  
  // Room Sensor
  display.setCursor(0, 40);
  display.print("Room: ");
  display.print(temp, 1);
  display.print("C  ");
  display.print(hum, 0);
  display.println("%");
  
  // Connection Status
  display.setCursor(0, 55);
  display.print(WiFi.status() == WL_CONNECTED ? "WiFi:OK" : "WiFi:X");
  display.setCursor(70, 55);
  display.print(client.connected() ? "MQTT:OK" : "MQTT:X");
  
  display.display();
}

// ===========================
// BRAND DETECTION
// ===========================
String getBrand(decode_type_t protocol) {
  switch (protocol) {
    case COOLIX: return "Coolix";
    case DAIKIN: case DAIKIN2: case DAIKIN216: case DAIKIN160: return "Daikin";
    case MITSUBISHI_AC: return "Mitsubishi";
    case SAMSUNG_AC: return "Samsung";
    case LG: case LG2: return "LG";
    case SHARP_AC: return "Sharp";
    case PANASONIC_AC: return "Panasonic";
    case HITACHI_AC: case HITACHI_AC1: case HITACHI_AC2: return "Hitachi";
    case FUJITSU_AC: return "Fujitsu";
    case GREE: return "Gree";
    case WHIRLPOOL_AC: return "Whirlpool";
    default: return "Unknown";
  }
}

// ===========================
// STORAGE
// ===========================
void saveProtocol() {
  preferences.begin("ac-config", false);
  preferences.putInt("protocol", (int)currentProtocol);
  preferences.putString("brand", currentBrand);
  preferences.end();
  Serial.println("✅ Protocol saved");
}

void loadProtocol() {
  preferences.begin("ac-config", true);
  currentProtocol = (decode_type_t)preferences.getInt("protocol", (int)decode_type_t::UNKNOWN);
  currentBrand = preferences.getString("brand", "none");
  preferences.end();
  
  if (currentProtocol != decode_type_t::UNKNOWN) {
    Serial.printf("✅ Loaded: %s (%s)\n", currentBrand.c_str(), typeToString(currentProtocol).c_str());
    configureAC();
  }
}

void configureAC() {
  ac.next.protocol = currentProtocol;
  ac.next.model = 1;
  ac.next.celsius = true;
  ac.next.degrees = 25;
  ac.next.mode = stdAc::opmode_t::kCool;
  ac.next.fanspeed = stdAc::fanspeed_t::kAuto;
  ac.next.power = false;
  
  mqttTopicData = "ac/" + currentBrand + "/data";
  mqttTopicCmd = "ac/" + currentBrand + "/cmd";
  mqttTopicStatus = "ac/" + currentBrand + "/status";
  
  Serial.printf("✅ AC configured: %s\n", currentBrand.c_str());
}

// ===========================
// WIFI & MQTT
// ===========================
void setupWiFi() {
  Serial.print("🔌 WiFi...");
  showMessage("Connecting WiFi", ssid, "");
  
  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi OK!");
    Serial.println(WiFi.localIP());
    showMessage("WiFi Connected!", WiFi.localIP().toString().c_str(), "");
    delay(1000);
  } else {
    Serial.println("\n❌ WiFi Failed!");
    showMessage("WiFi Failed!", "", "");
    delay(1000);
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, payload, length)) {
    Serial.println("❌ JSON error");
    return;
  }
  
  String cmd = doc["command"] | "";
  int temp = doc["temperature"] | 25;
  Serial.printf("📩 CMD: %s\n", cmd.c_str());
  
  handleCommand(cmd, temp);
}

void reconnectMQTT() {
  if (client.connected()) return;
  
  Serial.print("🔗 MQTT...");
  showMessage("Connecting MQTT", mqtt_broker, "");
  
  String clientId = "ESP32_AC_" + String(random(0xffff), HEX);
  
  if (client.connect(clientId.c_str(), mqtt_username, mqtt_password)) {
    Serial.println("✅ MQTT OK!");
    client.subscribe(mqttTopicCmd.c_str());
    showMessage("MQTT Connected!", "", "");
    delay(1000);
  } else {
    Serial.printf("❌ Failed rc=%d\n", client.state());
  }
}

// ===========================
// AC CONTROL
// ===========================
void sendACState() {
  if (currentProtocol == decode_type_t::UNKNOWN) return;
  
  ac.next.power = powerStatus;
  ac.next.degrees = currentTemp;
  ac.next.mode = currentMode;
  ac.sendAc();
  
  digitalWrite(LED_PIN, powerStatus ? HIGH : LOW);
}

void handleCommand(String cmd, int temp) {
  if (currentProtocol == decode_type_t::UNKNOWN) {
    Serial.println("⚠️ No AC configured");
    showMessage("Error!", "No AC detected", "");
    delay(1000);
    return;
  }
  
  bool success = false;
  String msg1 = "", msg2 = "";
  
  if (cmd == "ON") {
    powerStatus = true;
    currentTemp = 25;
    currentMode = stdAc::opmode_t::kCool;
    sendACState();
    success = true;
    msg1 = "AC ON";
    msg2 = "25C COOL";
    Serial.println("🔵 AC ON");
  }
  else if (cmd == "OFF") {
    powerStatus = false;
    sendACState();
    success = true;
    msg1 = "AC OFF";
    Serial.println("🔵 AC OFF");
  }
  else if (cmd == "TEMP_UP" && powerStatus && currentTemp < 30) {
    currentTemp++;
    sendACState();
    success = true;
    msg1 = "Temp UP";
    msg2 = String(currentTemp) + " C";
    Serial.printf("🌡️ Temp: %d°C\n", currentTemp);
  }
  else if (cmd == "TEMP_DOWN" && powerStatus && currentTemp > 16) {
    currentTemp--;
    sendACState();
    success = true;
    msg1 = "Temp DOWN";
    msg2 = String(currentTemp) + " C";
    Serial.printf("🌡️ Temp: %d°C\n", currentTemp);
  }
  else if (cmd == "SET_TEMP" && powerStatus && temp >= 16 && temp <= 30) {
    currentTemp = temp;
    sendACState();
    success = true;
    msg1 = "Set Temp";
    msg2 = String(currentTemp) + " C";
    Serial.printf("🌡️ Set: %d°C\n", currentTemp);
  }
  else if (cmd.startsWith("MODE_") && powerStatus) {
    if (cmd == "MODE_COOL") currentMode = stdAc::opmode_t::kCool;
    else if (cmd == "MODE_HEAT") currentMode = stdAc::opmode_t::kHeat;
    else if (cmd == "MODE_DRY") currentMode = stdAc::opmode_t::kDry;
    else if (cmd == "MODE_FAN") currentMode = stdAc::opmode_t::kFan;
    sendACState();
    success = true;
    msg1 = "Mode Changed";
    Serial.printf("🔄 Mode: %s\n", cmd.c_str());
  }
  
  if (success && msg1.length() > 0) {
    showMessage(msg1.c_str(), msg2.c_str(), "");
    delay(1000);
  }
  
  // Send status
  StaticJsonDocument<256> doc;
  doc["command"] = cmd;
  doc["status"] = success ? "success" : "failed";
  doc["power"] = powerStatus;
  doc["temp"] = currentTemp;
  
  char buffer[256];
  serializeJson(doc, buffer);
  client.publish(mqttTopicStatus.c_str(), buffer);
}

void sendSensorData() {
  if (currentProtocol == decode_type_t::UNKNOWN) return;
  
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  
  if (isnan(t) || isnan(h)) {
    Serial.println("❌ DHT22 error");
    return;
  }
  
  StaticJsonDocument<512> doc;
  doc["temperature"] = t;
  doc["humidity"] = h;
  doc["power"] = powerStatus;
  doc["ac_temp"] = currentTemp;
  
  char buffer[512];
  serializeJson(doc, buffer);
  client.publish(mqttTopicData.c_str(), buffer);
  
  updateDisplay(t, h);
  Serial.printf("📤 T=%.1f°C H=%.1f%%\n", t, h);
}

// ===========================
// IR DETECTION
// ===========================
void detectProtocol() {
  Serial.println("\n📡 Point remote and press button...");
  Serial.println("Timeout: 30 seconds");
  showMessage("Detect Protocol", "Press remote", "button...");
  
  // Clear buffer IR sebelum mulai
  irrecv.resume();
  
  unsigned long startTime = millis();
  bool detected = false;
  
  while (!detected && (millis() - startTime < 30000)) {
    // Cek tombol fisik untuk cancel jika user berubah pikiran
    if (digitalRead(BUTTON_PIN) == LOW) {
      delay(200); // debounce
      Serial.println("⚠️ Cancelled by user");
      showMessage("Cancelled", "", "");
      delay(1000);
      return; 
    }

    if (irrecv.decode(&results)) {
      decode_type_t protocol = results.decode_type;
      
      // Filter noise (panjang raw data terlalu pendek)
      if (results.rawlen < 10) {
         irrecv.resume();
         continue;
      }

      if (protocol == UNKNOWN) {
        Serial.println("⚠️ Unknown, retry...");
        showMessage("Unknown Protocol", "Try again...", "");
        delay(500);
        irrecv.resume();
        continue;
      }
      
      Serial.printf("\n✅ Detected: %s\n", typeToString(protocol).c_str());
      showMessage("Detected!", typeToString(protocol).c_str(), "");
      delay(1000);
      
      if (IRac::isProtocolSupported(protocol)) {
        Serial.println("✅ Supported!");
        currentProtocol = protocol;
        currentBrand = getBrand(protocol);
        
        saveProtocol();
        configureAC();
        
        if (client.connected()) {
          client.unsubscribe("#");
          client.subscribe(mqttTopicCmd.c_str());
        }
        
        showMessage("AC Configured!", currentBrand.c_str(), "Ready!");
        delay(2000);
        detected = true;
      } else {
        Serial.println("❌ Not supported by IRac");
        showMessage("Not Supported!", "Try another AC", "");
        delay(2000);
      }
      
      irrecv.resume();
    }
    delay(100);
  }
  
  if (!detected) {
    Serial.println("⏱️ Timeout");
    showMessage("Timeout!", "No signal", "");
    delay(1500);
  }
}

// ===========================
// TEST FUNCTION
// ===========================
void testAC() {
  if (currentProtocol == decode_type_t::UNKNOWN) {
    Serial.println("⚠️ No AC configured");
    showMessage("Error!", "Detect AC first", "");
    delay(1500);
    return;
  }
  
  Serial.println("\n🧪 Testing sequence...");
  
  showMessage("Test 1/4", "Turn ON 25C", "");
  powerStatus = true;
  currentTemp = 25;
  sendACState();
  delay(3000);
  
  showMessage("Test 2/4", "Set 22C", "");
  currentTemp = 22;
  sendACState();
  delay(3000);
  
  showMessage("Test 3/4", "Set 28C", "");
  currentTemp = 28;
  sendACState();
  delay(3000);
  
  showMessage("Test 4/4", "Turn OFF", "");
  powerStatus = false;
  sendACState();
  delay(2000);
  
  Serial.println("✅ Test complete!");
  showMessage("Test Complete!", "All OK!", "");
  delay(2000);
}

// ===========================
// MENU
// ===========================
void printMenu() {
  Serial.println("\n╔════════════════════════════════════╗");
  Serial.println("║   ESP32 AC Control - Simplified   ║");
  Serial.println("╚════════════════════════════════════╝");
  Serial.println("[Button 4] Detect AC Protocol");
  Serial.println("[1] Detect AC Protocol (Serial)");
  Serial.println("[2] Test AC");
  Serial.println("[3] Send Sensor Data");
  Serial.println("[4] Clear Config");
  Serial.println();
  
  if (currentProtocol != decode_type_t::UNKNOWN) {
    Serial.printf("Current AC: %s (%s)\n", 
                  currentBrand.c_str(), 
                  typeToString(currentProtocol).c_str());
  } else {
    Serial.println("Current AC: None (Use Button/Press 1 to detect)");
  }
  Serial.println();
}

void clearConfig() {
  Serial.print("⚠️  Clear config? (y/n): ");
  showMessage("Clear Config?", "Type 'y' in", "Serial Monitor");
  
  while (!Serial.available()) delay(10);
  String confirm = Serial.readStringUntil('\n');
  confirm.trim();
  
  if (confirm == "y" || confirm == "Y") {
    preferences.begin("ac-config", false);
    preferences.clear();
    preferences.end();
    
    currentProtocol = decode_type_t::UNKNOWN;
    currentBrand = "none";
    
    Serial.println("✅ Config cleared!");
    showMessage("Config Cleared!", "Restarting...", "");
    delay(2000);
    ESP.restart();
  } else {
    Serial.println("Cancelled");
    showMessage("Cancelled", "", "");
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
  
  // Setup Button dengan Pull-up internal
  // Button ditekan = LOW, dilepas = HIGH
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  
  // OLED Init
  Wire.begin(SDA_PIN, SCL_PIN);
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("❌ OLED failed");
    while(1); // Stop here
  }
  
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("ESP32 AC Control");
  display.println("Simplified v1.0");
  display.println("");
  display.println("Initializing...");
  display.display();
  delay(1000);
  
  // Load saved config
  loadProtocol();
  
  // Initialize hardware
  dht.begin();
  irrecv.enableIRIn(); // Start receiver
  
  // Network
  setupWiFi();
  client.setServer(mqtt_broker, mqtt_port);
  client.setCallback(mqttCallback);
  reconnectMQTT();
  
  Serial.println("\n✅ System Ready!");
  
  if (currentProtocol == decode_type_t::UNKNOWN) {
    showMessage("Ready!", "No AC detected", "Press Button");
  } else {
    showMessage("Ready!", currentBrand.c_str(), "Configured!");
  }
  delay(2000);
  
  printMenu();
}

// ===========================
// LOOP
// ===========================
void loop() {
  // Connection management
  if (!client.connected()) reconnectMQTT();
  client.loop();
  
  unsigned long now = millis();
  
  // --------------------------
  // CEK TOMBOL FISIK (GPIO 4)
  // --------------------------
  // Karena INPUT_PULLUP, LOW berarti ditekan
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(50); // Debounce sederhana
    if (digitalRead(BUTTON_PIN) == LOW) {
      Serial.println("🔘 Button Pressed! Starting Detection...");
      detectProtocol();
      
      // Tunggu tombol dilepas agar tidak looping
      while(digitalRead(BUTTON_PIN) == LOW) {
        delay(10);
      }
      
      printMenu(); // Tampilkan menu lagi setelah selesai
    }
  }

  // Auto-send sensor data
  if (currentProtocol != decode_type_t::UNKNOWN && 
      now - lastDataSend > DATA_SEND_INTERVAL) {
    sendSensorData();
    lastDataSend = now;
  }
  
  // Auto-update display
  if (now - lastDisplayUpdate > DISPLAY_UPDATE_INTERVAL) {
    lastDisplayUpdate = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) {
      updateDisplay(t, h);
    }
  }
  
  // Serial menu
  if (Serial.available()) {
    char cmd = Serial.readStringUntil('\n')[0];
    switch (cmd) {
      case '1': detectProtocol(); break;
      case '2': testAC(); break;
      case '3': sendSensorData(); break;
      case '4': clearConfig(); break;
      // default: Serial.println("❌ Invalid"); break;
    }
    printMenu();
  }
}
