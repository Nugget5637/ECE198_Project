#include <Arduino.h>
#include <WiFi.h>
#include "esp_camera.h"
#include "Constants.h"



void setup() {
  Serial.begin(115200);
  Serial.println("Starting ESP-32");

  if (!esp_camera_init(&CameraConstants::CONFIG)) {
    Serial.println("Camera initilization failed");
    return;
  } else {
    Serial.println("Camera connected");
  }

  WiFi.begin(WifiConstants::SSID, WifiConstants::PASSWORD);

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
