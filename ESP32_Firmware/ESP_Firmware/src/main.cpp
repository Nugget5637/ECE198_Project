#include <Arduino.h>
#include <WiFi.h>
#include "esp_camera.h"
#include "Constants.h"

void GetJPEGImage(uint8_t *&buffer, size_t &size) {
  camera_fb_t *frame_buffer = esp_camera_fb_get();
  
  bool convert_success = fmt2jpg(frame_buffer->buf, frame_buffer->len, frame_buffer->width, frame_buffer->height, frame_buffer->format, CameraConstants::QUALITY, &buffer, &size);
  if (convert_success != true) {
    Serial.println("Conversion Failed");
  }

  esp_camera_fb_return(frame_buffer);
}

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
