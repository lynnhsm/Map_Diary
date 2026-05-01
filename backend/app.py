import os
import json
import uuid
import urllib.request
import urllib.parse

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIARY_FILE = os.path.join(BASE_DIR, 'diary.json')
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['MAX_CONTENT_LENGTH'] = 12 * 1024 * 1024  # 12MB

ALLOWED_EXT = {'jpg', 'jpeg', 'png', 'webp', 'gif'}

# Simple in-memory cache for reverse geocoding
GEOCODE_CACHE = {}

def ensure_diary_structure(data):
    if not isinstance(data, dict):
        data = {}
    if data.get("type") != "FeatureCollection":
        data["type"] = "FeatureCollection"
    if "features" not in data or not isinstance(data["features"], list):
        data["features"] = []
    if "trips" not in data or not isinstance(data["trips"], dict):
        data["trips"] = {}
    return data

def load_diary():
    if not os.path.exists(DIARY_FILE):
        return ensure_diary_structure({"type": "FeatureCollection", "features": [], "trips": {}})

    try:
        with open(DIARY_FILE, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            if not content:
                return ensure_diary_structure({"type": "FeatureCollection", "features": [], "trips": {}})
            data = json.loads(content)
            return ensure_diary_structure(data)
    except Exception as e:
        print("⚠️ diary.json beschädigt, wird neu initialisiert:", e)
        return ensure_diary_structure({"type": "FeatureCollection", "features": [], "trips": {}})

def save_diary(data):
    data = ensure_diary_structure(data)
    with open(DIARY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

def reverse_geocode(lat, lng):
    """
    Reverse geocode with OSM Nominatim.
    Returns (country_de, continent_de_or_empty)
    """
    key = f"{round(lat, 5)}|{round(lng, 5)}"
    if key in GEOCODE_CACHE:
        return GEOCODE_CACHE[key]

    base_url = "https://nominatim.openstreetmap.org/reverse"
    params = {
        "lat": lat,
        "lon": lng,
        "format": "json",
        "addressdetails": 1,
        "zoom": 3,
        "accept-language": "de"  # request german names
    }

    url = base_url + "?" + urllib.parse.urlencode(params)

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "TravelMapDiary-UniProjekt/1.0 (local dev)",
            "Accept-Language": "de"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=6) as response:
            data = json.loads(response.read().decode("utf-8"))
            address = data.get("address", {})

            country = address.get("country", "") or ""
            continent = address.get("continent", "") or ""  # may be empty

            # Optional fallback mapping if continent missing:
            # (kept minimal – you can extend)
            if not continent and country:
                fallback = {
                    "Deutschland": "Europa",
                    "Frankreich": "Europa",
                    "Italien": "Europa",
                    "Spanien": "Europa",
                    "Japan": "Asien",
                    "Südkorea": "Asien",
                    "China": "Asien",
                    "USA": "Nordamerika",
                    "Vereinigte Staaten": "Nordamerika",
                    "Kanada": "Nordamerika",
                    "Brasilien": "Südamerika",
                    "Australien": "Ozeanien",
                    "Südafrika": "Afrika"
                }
                continent = fallback.get(country, "")

            GEOCODE_CACHE[key] = (country, continent)
            return country, continent

    except Exception as e:
        print("Reverse-Geocoding-Fehler:", e)
        return "", ""

@app.route('/api/pins', methods=['GET'])
def get_pins():
    return jsonify(load_diary())

@app.route('/api/pins', methods=['POST'])
def add_pin():
    diary = load_diary()

    title = request.form.get('title', '')
    date = request.form.get('date', '')
    time_ = request.form.get('time', '')
    datetime_ = request.form.get('datetime', '')
    description = request.form.get('description', '')

    user = request.form.get('user', '')
    trip = request.form.get('trip', '')
    place_type = request.form.get('placeType', '')
    trip_color = request.form.get('tripColor', '#0078D7')

    tags = request.form.get('tags', '')
    if (not user or not trip) and tags:
        parts = [p.strip() for p in tags.split(',')]
        if not user and len(parts) > 0:
            user = parts[0]
        if not trip and len(parts) > 1:
            trip = parts[1]

    # Build datetime if not provided
    if not datetime_ and date and time_:
        datetime_ = f"{date}T{time_}"

    lat = float(request.form.get('lat'))
    lng = float(request.form.get('lng'))

    # Auto country/continent
    country, continent = reverse_geocode(lat, lng)

    # Save images
    image_files = request.files.getlist('images')
    filenames = []

    for img in image_files:
        if img and img.filename:
            if '.' not in img.filename:
                continue
            ext = img.filename.rsplit('.', 1)[-1].lower()
            if ext not in ALLOWED_EXT:
                continue
            fname = f"{uuid.uuid4().hex}.{ext}"
            img.save(os.path.join(UPLOAD_FOLDER, fname))
            filenames.append(fname)

    # Store trip color persistently
    tkey = f"{user}|||{trip}"
    diary["trips"][tkey] = {"color": trip_color}

    new_feature = {
        "type": "Feature",
        "properties": {
            "title": title,
            "date": date,
            "time": time_,
            "datetime": datetime_,
            "description": description,
            "user": user,
            "trip": trip,
            "tags": tags if tags else (f"{user}, {trip}" if user and trip else ""),
            "placeType": place_type,
            "country": country,
            "continent": continent,
            "images": filenames
        },
        "geometry": {
            "type": "Point",
            "coordinates": [lng, lat]
        }
    }

    diary["features"].append(new_feature)
    save_diary(diary)

    return jsonify({"status": "success"}), 201

@app.route('/api/uploads/<filename>', methods=['GET'])
def get_image(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == '__main__':
    app.run(debug=True, port=5000)