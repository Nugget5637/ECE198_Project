#include <Arduino.h>
#include <WiFi.h>
#include "esp_camera.h"


const char* SSID = "";
const char* PASSWORD = "a";

void setup() {
  // put your setup code here, to run once:
  Serial.println("Starting ESP-32");

  WiFi.begin(SSID, PASSWORD);

  if (WiFi.status() == WL_NO_SHIELD) {
    Serial.println("Shield Missing");
  }

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (WiFi.status() == WL_CONNECT_FAILED) {
      Serial.println(" Connection Failed");
      return;
    }
  }
  Serial.println("");
  Serial.println("Wifi-Connected");
  Serial.println("Camera IP: " + WiFi.localIP());


}

void loop() {
  // put your main code here, to run repeatedly:
}
