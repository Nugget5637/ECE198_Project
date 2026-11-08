#include <Arduino.h>
#include <WiFi.h>
#include "esp_camera.h"
#include "Constants.h"
#include "esp_http_server.h"

httpd_handle_t server_handle = NULL;

static esp_err_t stream_handler(httpd_req_t *req) {
  esp_err_t result = ESP_OK;
  result = httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=123456789000000000000987654321");

  if (result != ESP_OK) {return result;}

  while (true) {
    uint8_t *buffer{nullptr};
    size_t size{0};

    GetJPEGImage(buffer, size);
    char str_buf[64];
    size_t hlen = snprintf(str_buf, 64, "\r\n--123456789000000000000987654321\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", size);
    result = httpd_resp_send_chunk(req, (const char *)str_buf, hlen);
    if (result != ESP_OK) {return result;}
    result = httpd_resp_send_chunk(req, (const char *)buffer, size);

    if(result != ESP_OK) break;
  }
  return result;
}

esp_err_t GetJPEGImage(uint8_t *&buffer, size_t &size) {
  camera_fb_t *frame_buffer = esp_camera_fb_get();
  if (!frame_buffer) {
    return ESP_FAIL;
  }
  bool convert_success = fmt2jpg(frame_buffer->buf, frame_buffer->len, frame_buffer->width, frame_buffer->height, frame_buffer->format, CameraConstants::QUALITY, &buffer, &size);
  if (convert_success != true) {
    Serial.println("Conversion Failed");
    return ESP_FAIL;
  }

  esp_camera_fb_return(frame_buffer);
  return ESP_OK;
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
 
  httpd_config_t server_config = HTTPD_DEFAULT_CONFIG();
  server_config.server_port = 81;

  if (httpd_start(&server_handle, &server_config) == ESP_OK) {
    httpd_uri_t stream_uri = { .uri = "/stream", .method = HTTP_GET, .handler = stream_handler, .user_ctx = NULL };
    httpd_register_uri_handler(server_handle, &stream_uri);
  } else {
    Serial.println("Server start error");
  }
  Serial.print("Camera stream ready. Open to http://");
  Serial.print(WiFi.localIP());
  Serial.println(":81/stream");
}

void loop() {
  // put your main code here, to run repeatedly:
  
  
}
