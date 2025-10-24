// Config
const GOOGLE_MAPS_API_KEY = 'AIzaSyAAyzxA1LOHge5Lb7X0BlUiXqDu-Td1fac'; // Set via env var
const AIRTABLE_BASE_ID = 'YOUR_AIRTABLE_BASE_ID';
const AIRTABLE_API_KEY = 'YOUR_AIRTABLE_API_KEY'; // Server-side only
const GA_TRACKING_ID = 'YOUR_GA_TRACKING_ID';
const ADMIN_PASSWORD = 'admin123'; // Change in production

// Global vars
let map, markers = [], clusterer;
let pharmacyVisible = true, aedVisible = true;
let resources = [];

// Initialize map
function initMap() {
    map = new google.maps.Map(document.getElementById('map'), { center: { lat: 0, lng: 0 }, zoom: 10 });
    clusterer = new markerClusterer.MarkerClusterer({ map, markers });

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            map.setCenter({ lat: position.coords.latitude, lng: position.coords.longitude });
        }, () => showSearch());
    } else {
        showSearch();
    }

    loadResources();
}

function showSearch() {
    document.getElementById('search-container').style.display = 'block';
    document.getElementById('search-btn').addEventListener('click', () => {
        const query = document.getElementById('search-input').value || 'Nearest Hospital';
        const service = new google.maps.places.PlacesService(map);
        service.textSearch({ query }, (results, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK) {
                map.setCenter(results[0].geometry.location);
            }
        });
    });
}

// Load resources from Airtable
async function loadResources() {
    const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Resources?api_key=${AIRTABLE_API_KEY}`);
    const data = await response.json();
    resources = data.records.map(r => r.fields);
    renderMarkers();
}

// Render markers
function renderMarkers() {
    markers.forEach(m => m.setMap(null));
    markers = [];
    clusterer.clearMarkers();

    resources.forEach(r => {
        if ((r.resource_type === '24-Hour Pharmacy' && pharmacyVisible) || (r.resource_type === 'AED Location' && aedVisible)) {
            const icon = r.resource_type === '24-Hour Pharmacy' ? getPharmacyIcon(r.verification_status) : getAEDIcon(r.verification_status);
            const marker = new google.maps.Marker({ position: { lat: r.latitude, lng: r.longitude }, map, icon });
            marker.addListener('click', () => showPopup(r));
            markers.push(marker);
        }
    });
    clusterer.addMarkers(markers);
}

function getPharmacyIcon(verified) {
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
        <svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="18" fill="#1565C0"/>
            <text x="20" y="25" text-anchor="middle" fill="#fff" font-size="12">Rx</text>
            ${verified === 'Verified In-Person' || verified === 'Verified by Phone/Website' ? '<circle cx="30" cy="10" r="5" fill="#2E7D32"/><text x="30" y="14" text-anchor="middle" fill="#fff" font-size="8">✓</text>' : ''}
        </svg>`), scaledSize: new google.maps.Size(40, 40) };
}

function getAEDIcon(verified) {
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
        <svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="18" fill="#FF7043"/>
            <text x="20" y="25" text-anchor="middle" fill="#fff" font-size="10">AED</text>
            ${verified === 'Verified In-Person' || verified === 'Verified by Phone/Website' ? '<circle cx="30" cy="10" r="5" fill="#2E7D32"/><text x="30" y="14" text-anchor="middle" fill="#fff" font-size="8">✓</text>' : ''}
        </svg>`), scaledSize: new google.maps.Size(40, 40) };
}

// Show popup
function showPopup(r) {
    document.getElementById('popup-name').textContent = r.location_name;
    document.getElementById('verification-status').innerHTML = `<span class="${r.verification_status.includes('Verified') ? 'verified' : 'unverified'}">${r.verification_status} ${r.verification_date ? 'on ' + r.verification_date : ''}</span>`;
    document.getElementById('operating-status').textContent = r.operating_status || 'Unknown';
    document.getElementById('address').textContent = r.address;
    document.getElementById('accessibility-notes').textContent = r.accessibility_notes;
    document.getElementById('photo-thumb').src = r.photo_url;
    document.getElementById('navigate-btn').onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${r.latitude},${r.longitude}`);
    if (r.phone) document.getElementById('call-btn').style.display = 'inline'; document.getElementById('call-btn').onclick = () => window.location.href = `tel:${r.phone}`;
    document.getElementById('report-btn').onclick = () => alert('Report form: [simple form here]');
    document.getElementById('popup').style.display = 'block';
    gtag('event', 'view_pin', { resource_type: r.resource_type });
}

// Toggle handlers
document.getElementById('pharmacy-toggle').addEventListener('click', () => {
    pharmacyVisible = !pharmacyVisible;
    document.getElementById('pharmacy-toggle').classList.toggle('active');
    renderMarkers();
    gtag('event', 'filter_toggle', { filter: 'pharmacy' });
});
document.getElementById('aed-toggle').addEventListener('click', () => {
    aedVisible = !aedVisible;
    document.getElementById('aed-toggle').classList.toggle('active');
    renderMarkers();
    gtag('event', 'filter_toggle', { filter: 'aed' });
});

// Admin
document.getElementById('admin-login').addEventListener('click', () => {
    if (document.getElementById('admin-password').value === ADMIN_PASSWORD) {
        document.getElementById('admin-content').style.display = 'block';
    }
});
document.getElementById('upload-btn').addEventListener('click', async () => {
    const file = document.getElementById('csv-upload').files[0];
    const text = await file.text();
    const rows = text.split('\n').slice(1);
    rows.forEach(row => {
        const [location_name, latitude, longitude, resource_type, verification_status, verification_date, operating_status, accessibility_notes, photo_url, address] = row.split(',');
        if (latitude && longitude) {
            // POST to Airtable (use serverless for security)
            fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Resources`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: { location_name, latitude: parseFloat(latitude), longitude: parseFloat(longitude), resource_type, verification_status: verification_status || 'Unverified', verification_date, operating_status: operating_status || 'Unknown', accessibility_notes, photo_url, address } })
            });
        }
    });
    loadResources();
});

// Init
window.onload = initMap;