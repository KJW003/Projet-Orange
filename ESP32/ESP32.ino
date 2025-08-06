#include <WiFi.h>
#include <WebSocketsClient.h>
#include <Ticker.h>
#include <Arduino_JSON.h>

// ——— Config Wi-Fi ———
const char* WIFI_SSID     = "Hotspot";
const char* WIFI_PASSWORD = "123412349";

// ——— Serveur WS ———
const char* WS_HOST = "projet-orange.onrender.com";
const uint16_t WS_PORT = 443; // HTTPS/WSS sur Render
const char* WS_PATH = "/ws";

// ——— Pin LED ———
const int LED_PIN = 2; // LED intégrée de l'ESP32

WebSocketsClient webSocket;
Ticker heartbeat;
Ticker ledTimer;

// Callback WebSocket
void onWsEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_CONNECTED:
      Serial.println("[WS] Connecté"); break;
    case WStype_DISCONNECTED:
      Serial.println("[WS] Déconnecté"); break;
    case WStype_TEXT: {
      String msg = String((char*)payload);
      JSONVar obj = JSON.parse(msg);
      if (JSON.typeof(obj) == "undefined") return;
      String action   = (const char*) obj["action"];
      int    duration = (int) obj["duration"];
      if (action == "on") {
        digitalWrite(LED_PIN, HIGH);
        ledTimer.detach();
        ledTimer.once_ms(duration, [](){
          digitalWrite(LED_PIN, LOW);
          webSocket.sendTXT("{\"event\":\"led_off\"}");
        });
        webSocket.sendTXT("{\"event\":\"led_on\"}");
      }
      break;
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Connexion Wi-Fi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.printf("\nWi-Fi OK, IP=%s\n", WiFi.localIP().toString().c_str());

  // Setup WebSocket SSL pour Render
  webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(onWsEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 3);

  // Heartbeat périodique
  heartbeat.attach(10, [](){
    if (webSocket.isConnected())
      webSocket.sendTXT("{\"event\":\"heartbeat\"}");
  });
}

void loop() {
  webSocket.loop();
}
