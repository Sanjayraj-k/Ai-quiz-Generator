from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import numpy as np
import base64
import time
import winsound
from math import hypot
import logging
import sys

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Test basic imports and environment
logger.info("Starting Flask application")
logger.info(f"Python version: {sys.version}")
logger.info(f"OpenCV version: {cv2.__version__}")

# Load Haar Cascade models
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')

if face_cascade.empty() or eye_cascade.empty():
    logger.error("Failed to load Haar Cascade models")
    raise RuntimeError("Failed to load Haar Cascade models")
logger.info("Haar Cascade models loaded successfully")

# Global variables
ALERT_ENABLED = True
looking_away = False
looking_away_start_time = 0
alert_threshold = 1.5
last_alert_time = 0
alert_cooldown = 5.0
warnings = 0
max_warnings = 3
long_blink_count = 0

def play_alert():
    global ALERT_ENABLED
    if ALERT_ENABLED:
        try:
            winsound.Beep(1000, 300)
            logger.info("Alert sound played")
        except Exception as e:
            logger.error(f"Failed to play alert: {e}")
    logger.warning("ALERT: Not looking at camera!")

def detect_gaze(eye_frame):
    try:
        height, width = eye_frame.shape[:2]
        _, threshold_eye = cv2.threshold(eye_frame, 55, 255, cv2.THRESH_BINARY_INV)
        kernel = np.ones((3, 3), np.uint8)
        threshold_eye = cv2.morphologyEx(threshold_eye, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(threshold_eye, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        if len(contours) > 0:
            contour = max(contours, key=cv2.contourArea)
            if cv2.contourArea(contour) > 10:
                M = cv2.moments(contour)
                if M["m00"] != 0:
                    pupil_cx = int(M["m10"] / M["m00"])
                    pupil_cy = int(M["m01"] / M["m00"])
                    relative_x = pupil_cx / width
                    if 0.3 <= relative_x <= 0.7:
                        return "center", relative_x
                    elif relative_x < 0.3:
                        return "left", relative_x
                    else:
                        return "right", relative_x
        return "center", 0.5
    except Exception as e:
        logger.error(f"Error in detect_gaze: {e}")
        return "center", 0.5

def process_image(image_data):
    global looking_away, looking_away_start_time, last_alert_time, warnings, long_blink_count
    try:
        img_bytes = base64.b64decode(image_data.split(',')[1])
        np_arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Failed to decode image")
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.3, 5)
        current_time = time.time()

        face_detected = len(faces) > 0
        looking_at_screen = False
        look_direction = "Unknown"
        eyes_closed = False
        blink_duration = 0
        violation_detected = False

        if not face_detected:
            if not looking_away:
                looking_away = True
                looking_away_start_time = current_time
            elif current_time - looking_away_start_time > alert_threshold:
                if current_time - last_alert_time > alert_cooldown:
                    play_alert()
                    last_alert_time = current_time
                    warnings += 1
                violation_detected = warnings >= max_warnings
        else:
            looking_away = False
            for (x, y, w, h) in faces:
                roi_gray = gray[y:y + h, x:x + w]
                eyes = eye_cascade.detectMultiScale(roi_gray, 1.1, 5)
                if len(eyes) == 0:
                    eyes_closed = True
                    blink_duration = current_time - (looking_away_start_time if looking_away else current_time)
                    if blink_duration > 2:
                        long_blink_count += 1
                else:
                    for (ex, ey, ew, eh) in eyes:
                        eye_frame = roi_gray[ey:ey + eh, ex:ex + ew]
                        direction, _ = detect_gaze(eye_frame)
                        look_direction = direction
                        looking_at_screen = direction == "center"
                        break
                if not looking_at_screen:
                    if not looking_away:
                        looking_away = True
                        looking_away_start_time = current_time
                    elif current_time - looking_away_start_time > alert_threshold:
                        if current_time - last_alert_time > alert_cooldown:
                            play_alert()
                            last_alert_time = current_time
                            warnings += 1
                        violation_detected = warnings >= max_warnings

        proctor_data = {
            "face_detected": face_detected,
            "looking_at_screen": looking_at_screen,
            "warnings": warnings,
            "max_warnings": max_warnings,
            "violation_detected": violation_detected,
            "look_direction": look_direction,
            "eyes_closed": eyes_closed,
            "blink_duration": blink_duration,
            "long_blink_count": long_blink_count,
            "head_pose": [0, 0, 0],
            "ear": 0
        }
        logger.debug(f"Proctor data: {proctor_data}")
        return proctor_data
    except Exception as e:
        logger.error(f"Error processing image: {e}")
        return {
            "face_detected": False,
            "looking_at_screen": False,
            "warnings": warnings,
            "max_warnings": max_warnings,
            "violation_detected": False,
            "look_direction": "Unknown",
            "eyes_closed": False,
            "blink_duration": 0,
            "long_blink_count": long_blink_count,
            "head_pose": [0, 0, 0],
            "ear": 0,
            "error": str(e)
        }

@app.route('/start-exam', methods=['POST'])
def start_exam():
    global warnings, long_blink_count
    warnings = 0
    long_blink_count = 0
    logger.info("Exam session started")
    return jsonify({"status": "Exam started"}), 200

@app.route('/process-frame', methods=['POST'])
def process_frame():
    try:
        data = request.json
        if not data or 'image' not in data:
            logger.error("No image data provided")
            return jsonify({"error": "No image data provided"}), 400
        logger.debug("Received frame for processing")
        proctor_data = process_image(data['image'])
        return jsonify(proctor_data), 200
    except Exception as e:
        logger.error(f"Error in process_frame: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/end-exam', methods=['POST'])
def end_exam():
    global warnings, long_blink_count
    warnings = 0
    long_blink_count = 0
    logger.info("Exam session ended")
    return jsonify({"status": "Exam ended"}), 200

@app.route('/toggle_alerts', methods=['GET'])
def toggle_alerts():
    global ALERT_ENABLED
    ALERT_ENABLED = not ALERT_ENABLED
    status = "enabled" if ALERT_ENABLED else "disabled"
    logger.info(f"Alerts {status}")
    return jsonify({"status": f"Alerts {status}"}), 200

if __name__ == '__main__':
    logger.info("Starting Flask server on port 4000")
    app.run(host='0.0.0.0', port=4000, debug=True, use_reloader=False)