// =========================
// CONFIG
// =========================
const API_BASE = 'http://localhost:5000';

// =========================
// MAP SETUP
// =========================
const map = L.map('map').setView([50.0, 10.0], 4);

L.tileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

// Marker clustering group
let clusterGroup = L.markerClusterGroup();
map.addLayer(clusterGroup);

// =========================
// DOM
// =========================
const sidebar = document.getElementById('sidebar');
const sidebarContent = document.getElementById('sidebar-content');
const tripListEl = document.getElementById('trip-list');

const closeSidebarBtn = document.getElementById('close-sidebar');
const toggleBtn = document.getElementById('sidebar-toggle');

const filterUser = document.getElementById('filter-user');
const filterTrip = document.getElementById('filter-trip');
const filterRegion = document.getElementById('filter-region');
const clearFiltersBtn = document.getElementById('clear-filters');

// Topbar (optional)
const mapFilterUser = document.getElementById('map-filter-user');
const mapFilterTrip = document.getElementById('map-filter-trip');
const mapFilterYear = document.getElementById('map-filter-year');

const openSidebarBtn = document.getElementById('open-sidebar-btn');
const addPinBtn = document.getElementById('add-pin-btn');

// Modal
const pinModal = document.getElementById('pin-modal');
const closeModalBtn = document.getElementById('close-modal');
const pinForm = document.getElementById('pin-form');

// Form fields
const pinTitleEl = document.getElementById('pin-title');
const pinDateEl = document.getElementById('pin-date');
const pinTimeEl = document.getElementById('pin-time');
const pinUserEl = document.getElementById('pin-user');
const pinTripEl = document.getElementById('pin-tag');
const pinTypeEl = document.getElementById('pin-type');
const pinTripColorEl = document.getElementById('pin-trip-color');
const pinDescEl = document.getElementById('pin-desc');
const pinImagesEl = document.getElementById('pin-images');

// Datalists
const userDatalist = document.getElementById('user-list');
const tripDatalist = document.getElementById('trip-list-datalist');

// =========================
// GLOBAL DATA
// =========================
let allPinsData = null;           // full response
let allFeatures = [];             // feature array
let tripsMeta = {};               // from backend: tripsMeta[key] = {color:"#..."}
let tripsIndex = new Map();       // key -> {user, trip, pins[], color, countries:Set, continents:Set}
let currentLatLng = null;
let addMode = false;

// =========================
// HELPERS
// =========================
function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeProperties(props) {
  let user = props.user;
  let trip = props.trip;

  // Backward compatibility via tags: "User, Trip"
  if ((!user || !trip) && props.tags) {
    const parts = String(props.tags).split(',').map(s => s.trim());
    if (!user) user = parts[0] || '';
    if (!trip) trip = parts[1] || '';
  }

  const tags = props.tags || (user && trip ? `${user}, ${trip}` : '');

  // prefer datetime if present, else build from date+time if possible
  let datetime = props.datetime;
  if (!datetime && props.date && props.time) {
    datetime = `${props.date}T${props.time}`;
  }

  return {
    user: user || '',
    trip: trip || '',
    tags,
    datetime: datetime || '',
    placeType: props.placeType || '',
    country: props.country || '',
    continent: props.continent || ''
  };
}

function tripKey(user, trip) {
  return `${user}|||${trip}`;
}

function getTripColor(user, trip) {
  const key = tripKey(user, trip);
  return (tripsMeta && tripsMeta[key] && tripsMeta[key].color) ? tripsMeta[key].color : '#0078D7';
}

function parseYear(feature) {
  const p = feature.properties || {};
  const norm = normalizeProperties(p);
  const dt = norm.datetime || p.date || '';
  if (!dt) return '';
  const y = new Date(dt).getFullYear();
  return Number.isNaN(y) ? '' : String(y);
}

function openSidebar() {
  if (!sidebar) return;
  sidebar.classList.add('active');
  if (toggleBtn) toggleBtn.textContent = '❮';
}

function closeSidebar() {
  if (!sidebar) return;
  sidebar.classList.remove('active');
  if (toggleBtn) toggleBtn.textContent = '❯';
}

function toggleSidebar() {
  if (!sidebar) return;
  sidebar.classList.toggle('active');
  if (toggleBtn) toggleBtn.textContent = sidebar.classList.contains('active') ? '❮' : '❯';
}

function resetSelect(selectEl, firstLabel) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = firstLabel;
  selectEl.appendChild(opt);
}

function fillSelect(selectEl, values, firstLabel) {
  if (!selectEl) return;
  resetSelect(selectEl, firstLabel);
  [...values].sort((a, b) => String(a).localeCompare(String(b), 'de-DE'))
    .forEach(v => {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = String(v);
      selectEl.appendChild(opt);
    });
}

function fillDatalist(datalistEl, values) {
  if (!datalistEl) return;
  datalistEl.innerHTML = '';
  [...values].sort((a, b) => String(a).localeCompare(String(b), 'de-DE'))
    .forEach(v => {
      const opt = document.createElement('option');
      opt.value = String(v);
      datalistEl.appendChild(opt);
    });
}

// =========================
// BUILD INDEXES
// =========================
function rebuildTripsIndex() {
  tripsIndex = new Map();

  allFeatures.forEach(f => {
    const props = f.properties || {};
    const norm = normalizeProperties(props);
    f.properties = { ...props, ...norm };

    const key = tripKey(f.properties.user, f.properties.trip);
    if (!tripsIndex.has(key)) {
      tripsIndex.set(key, {
        key,
        user: f.properties.user,
        trip: f.properties.trip,
        pins: [],
        color: getTripColor(f.properties.user, f.properties.trip),
        countries: new Set(),
        continents: new Set()
      });
    }
    const entry = tripsIndex.get(key);
    entry.pins.push(f);

    if (f.properties.country) entry.countries.add(f.properties.country);
    if (f.properties.continent) entry.continents.add(f.properties.continent);
  });

  // If backend didn't provide trips meta, derive a fallback from pins
  if (!tripsMeta) tripsMeta = {};
  for (const entry of tripsIndex.values()) {
    const key = entry.key;
    if (!tripsMeta[key]) {
      tripsMeta[key] = { color: entry.color || '#0078D7' };
    }
  }
}

// =========================
// SUGGESTIONS (User/Trip inputs)
// =========================
function buildUserTripSuggestions() {
  const users = new Set();
  const trips = new Set();

  for (const entry of tripsIndex.values()) {
    if (entry.user) users.add(entry.user);
    if (entry.trip) trips.add(entry.trip);
  }

  fillDatalist(userDatalist, users);
  fillDatalist(tripDatalist, trips);
}

// When user chooses trip/user, auto-set the stored color if trip exists
function wireColorAutofill() {
  if (!pinUserEl || !pinTripEl || !pinTripColorEl) return;

  function updateColorFromExistingTrip() {
    const u = pinUserEl.value.trim();
    const t = pinTripEl.value.trim();
    if (!u || !t) return;

    const key = tripKey(u, t);
    if (tripsMeta && tripsMeta[key] && tripsMeta[key].color) {
      pinTripColorEl.value = tripsMeta[key].color;
    }
  }

  pinUserEl.addEventListener('input', updateColorFromExistingTrip);
  pinTripEl.addEventListener('input', updateColorFromExistingTrip);
}

// =========================
// SIDEBAR (Trips list + filters)
// =========================
function buildSidebarFilters() {
  if (!filterUser || !filterTrip || !filterRegion) return;

  const users = new Set();
  const trips = new Set();
  const regions = new Set();

  for (const entry of tripsIndex.values()) {
    if (entry.user) users.add(entry.user);
    if (entry.trip) trips.add(entry.trip);
    entry.countries.forEach(c => regions.add(c));
    entry.continents.forEach(c => regions.add(c));
  }

  fillSelect(filterUser, users, 'Alle Nutzer');
  fillSelect(filterTrip, trips, 'Alle Reisen');
  fillSelect(filterRegion, regions, 'Alle Länder / Kontinente');
}

function applySidebarFilters() {
  const u = filterUser ? filterUser.value : '';
  const t = filterTrip ? filterTrip.value : '';
  const r = filterRegion ? filterRegion.value : '';

  const entries = [...tripsIndex.values()].filter(entry => {
    const matchUser = !u || entry.user === u;
    const matchTrip = !t || entry.trip === t;
    const matchRegion = !r || entry.countries.has(r) || entry.continents.has(r);
    return matchUser && matchTrip && matchRegion;
  });

  buildTripList(entries);
}

function buildTripList(entries = [...tripsIndex.values()]) {
  if (!tripListEl) return;
  tripListEl.innerHTML = '';

  entries.sort((a, b) => {
    const u = a.user.localeCompare(b.user, 'de-DE');
    return u !== 0 ? u : a.trip.localeCompare(b.trip, 'de-DE');
  });

  if (entries.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Keine Reisen für diese Filter.';
    li.style.cursor = 'default';
    tripListEl.appendChild(li);
    return;
  }

  entries.forEach(entry => {
    const li = document.createElement('li');
    li.textContent = `${entry.trip} – ${entry.user}`;
    li.style.borderLeft = `8px solid ${entry.color || '#0078D7'}`;
    li.addEventListener('click', () => openTripTimeline(entry));
    tripListEl.appendChild(li);
  });
}

function openTripTimeline(entry) {
  if (!entry) return;
  openSidebar();

  // Sort by datetime first (date+time), fallback to date
  const pins = [...entry.pins].sort((a, b) => {
    const da = a.properties.datetime || a.properties.date || '';
    const db = b.properties.datetime || b.properties.date || '';
    return new Date(da) - new Date(db);
  });

  let html = `
    <h3>${escapeHtml(entry.trip)}</h3>
    <p><strong>${escapeHtml(entry.user)}</strong></p>
    <p style="margin-top:-6px;color:#555;">
      <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHtml(entry.color)};vertical-align:middle;margin-right:6px;"></span>
      Farbe: ${escapeHtml(entry.color)}
    </p>
    <div class="timeline">
  `;

  pins.forEach(pin => {
    const p = pin.properties || {};
    const dt = p.datetime || p.date || '';
    const dateObj = dt ? new Date(dt) : null;

    const dateStr = dateObj ? dateObj.toLocaleDateString('de-DE') : '';
    const timeStr = (dateObj && p.datetime) ? dateObj.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : (p.time || '');

    const imgArr = Array.isArray(p.images) ? p.images : [];
    const typeBadge = p.placeType ? `<span style="font-size:12px;background:#eef3ff;color:#234;padding:3px 8px;border-radius:999px;">${escapeHtml(p.placeType)}</span>` : '';

    let imagesHtml = '';
    if (imgArr.length > 0) {
      imagesHtml = `<div class="carousel">` +
        imgArr.map(img => {
          const src = `${API_BASE}/api/uploads/${encodeURIComponent(img)}`;
          return `<img src="${src}" alt="Reisebild">`;
        }).join('') +
        `</div>`;
    }

    html += `
      <div class="timeline-item">
        <span class="timeline-date">${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</span>
        ${typeBadge}
        <h4 class="timeline-title" style="margin-top:8px;">${escapeHtml(p.title)}</h4>
        <p class="timeline-desc">${escapeHtml(p.description)}</p>
        ${imagesHtml}
      </div>
    `;
  });

  html += `</div>`;
  if (sidebarContent) sidebarContent.innerHTML = html;
}

// =========================
// TOPBAR MAP FILTERS (User/Trip/Year)
// =========================
function buildMapFilters() {
  if (!mapFilterUser || !mapFilterTrip || !mapFilterYear) return;

  const users = new Set();
  const trips = new Set();
  const years = new Set();

  allFeatures.forEach(f => {
    const p = f.properties || {};
    const norm = normalizeProperties(p);
    if (norm.user) users.add(norm.user);
    if (norm.trip) trips.add(norm.trip);
    const y = parseYear(f);
    if (y) years.add(y);
  });

  fillSelect(mapFilterUser, users, 'Alle Nutzer');
  fillSelect(mapFilterTrip, trips, 'Alle Reisen');
  fillSelect(mapFilterYear, years, 'Alle Jahre');
}

function getMapFilterPredicate() {
  const u = mapFilterUser ? mapFilterUser.value : '';
  const t = mapFilterTrip ? mapFilterTrip.value : '';
  const y = mapFilterYear ? mapFilterYear.value : '';

  return function (feature) {
    const p = feature.properties || {};
    const norm = normalizeProperties(p);
    const year = parseYear(feature);

    return (!u || norm.user === u) &&
           (!t || norm.trip === t) &&
           (!y || year === y);
  };
}

// =========================
// MARKERS: colored + clustered
// =========================
function createTripIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div class="trip-marker" style="background:${color}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -8]
  });
}

function bindPopupToMarker(feature, marker) {
  const props = feature.properties || {};
  const norm = normalizeProperties(props);

  const key = tripKey(norm.user, norm.trip);

  const imgArr = Array.isArray(props.images) ? props.images : [];
  const preview = imgArr.length > 0
    ? `<img class="popup-preview" src="${API_BASE}/api/uploads/${encodeURIComponent(imgArr[0])}" alt="Vorschau">`
    : '';

  const dt = norm.datetime || props.date || '';
  const dateObj = dt ? new Date(dt) : null;
  const dateStr = dateObj ? dateObj.toLocaleDateString('de-DE') : '';
  const timeStr = (dateObj && norm.datetime) ? dateObj.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : (props.time || '');

  const typeLine = norm.placeType ? `<div style="margin:6px 0 0 0;"><strong>Typ:</strong> ${escapeHtml(norm.placeType)}</div>` : '';

  const popupContent = `
    ${preview}
    <strong>${escapeHtml(props.title)}</strong><br/>
    <span>${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</span>
    ${typeLine}
    <div style="margin-top:6px;color:#444;">
      <em>${escapeHtml(norm.user)} – ${escapeHtml(norm.trip)}</em>
    </div>
    <button class="popup-btn" type="button" onclick="window.openTrip('${encodeURIComponent(key)}')">
      Reise anzeigen
    </button>
  `;

  marker.bindPopup(popupContent, { minWidth: 220 });
}

function redrawClusteredMarkers() {
  if (!allPinsData) return;

  const predicate = getMapFilterPredicate();

  // clear + rebuild cluster group
  clusterGroup.clearLayers();

  allFeatures.filter(predicate).forEach(f => {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) return;

    const lng = coords[0];
    const lat = coords[1];

    const p = f.properties || {};
    const norm = normalizeProperties(p);

    const color = getTripColor(norm.user, norm.trip);
    const marker = L.marker([lat, lng], { icon: createTripIcon(color) });

    bindPopupToMarker(f, marker);
    clusterGroup.addLayer(marker);
  });
}

// Expose openTrip for popup button
window.openTrip = function (encodedKey) {
  try {
    const key = decodeURIComponent(encodedKey);
    const entry = tripsIndex.get(key);
    if (entry) openTripTimeline(entry);
  } catch {}
};

// =========================
// MODAL / PIN CREATION
// =========================
function openPinModal() {
  if (!pinModal) return;
  pinModal.classList.remove('hidden');

  if (pinDateEl) pinDateEl.max = new Date().toISOString().split('T')[0];

  // default time now (optional)
  if (pinTimeEl && !pinTimeEl.value) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    pinTimeEl.value = `${hh}:${mm}`;
  }
}

function closePinModal() {
  if (!pinModal) return;
  pinModal.classList.add('hidden');
}

map.on('click', function (e) {
  currentLatLng = e.latlng;
  openPinModal();

  if (addMode) {
    addMode = false;
    map.getContainer().style.cursor = '';
  }
});

if (closeModalBtn) closeModalBtn.addEventListener('click', closePinModal);

if (pinForm) {
  pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentLatLng) {
      alert('Bitte zuerst auf die Karte klicken.');
      return;
    }

    const user = pinUserEl ? pinUserEl.value.trim() : '';
    const trip = pinTripEl ? pinTripEl.value.trim() : '';
    const date = pinDateEl ? pinDateEl.value : '';
    const time = pinTimeEl ? pinTimeEl.value : '';
    const placeType = pinTypeEl ? pinTypeEl.value : '';
    const tripColor = pinTripColorEl ? pinTripColorEl.value : '#0078D7';

    const formData = new FormData();
    formData.append('title', pinTitleEl ? pinTitleEl.value : '');
    formData.append('date', date);
    formData.append('time', time);
    formData.append('datetime', (date && time) ? `${date}T${time}` : '');

    formData.append('description', pinDescEl ? pinDescEl.value : '');
    formData.append('user', user);
    formData.append('trip', trip);
    formData.append('placeType', placeType);
    formData.append('tripColor', tripColor);

    // tags backward compatible
    formData.append('tags', `${user}, ${trip}`);

    const imageFiles = pinImagesEl ? pinImagesEl.files : [];
    for (let i = 0; i < imageFiles.length; i++) formData.append('images', imageFiles[i]);

    formData.append('lat', currentLatLng.lat);
    formData.append('lng', currentLatLng.lng);

    try {
      const response = await fetch(`${API_BASE}/api/pins`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        alert('Pin gespeichert!');
        closePinModal();
        pinForm.reset();
        await loadPins();
      } else {
        alert('Fehler beim Speichern.');
      }
    } catch (err) {
      console.error(err);
      alert('Backend nicht erreichbar.');
    }
  });
}

// =========================
// UI WIRING
// =========================
if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
if (openSidebarBtn) openSidebarBtn.addEventListener('click', toggleSidebar);

if (addPinBtn) {
  addPinBtn.addEventListener('click', () => {
    addMode = true;
    map.getContainer().style.cursor = 'crosshair';
    alert('Klicke auf die Karte, um den neuen Pin zu platzieren.');
  });
}

if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener('click', () => {
    if (filterUser) filterUser.value = '';
    if (filterTrip) filterTrip.value = '';
    if (filterRegion) filterRegion.value = '';
    applySidebarFilters();
  });
}
if (filterUser) filterUser.addEventListener('change', applySidebarFilters);
if (filterTrip) filterTrip.addEventListener('change', applySidebarFilters);
if (filterRegion) filterRegion.addEventListener('change', applySidebarFilters);

function wireMapFilterListeners() {
  if (mapFilterUser) mapFilterUser.addEventListener('change', redrawClusteredMarkers);
  if (mapFilterTrip) mapFilterTrip.addEventListener('change', redrawClusteredMarkers);
  if (mapFilterYear) mapFilterYear.addEventListener('change', redrawClusteredMarkers);
}

// =========================
// LOAD PINS
// =========================
async function loadPins() {
  try {
    const response = await fetch(`${API_BASE}/api/pins`);
    allPinsData = await response.json();

    allFeatures = Array.isArray(allPinsData.features) ? allPinsData.features : [];
    tripsMeta = (allPinsData.trips && typeof allPinsData.trips === 'object') ? allPinsData.trips : {};

    rebuildTripsIndex();
    buildUserTripSuggestions();
    wireColorAutofill();

    buildSidebarFilters();
    applySidebarFilters();

    buildMapFilters();
    wireMapFilterListeners();

    redrawClusteredMarkers();
  } catch (error) {
    console.error('Fehler beim Laden:', error);
  }
}

loadPins();