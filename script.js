// ==========================================
// การตั้งค่าหลักและการระบุตัวแปร
// ==========================================
const API_URL = "https://script.google.com/macros/s/AKfycbwdXY5dvT9RR3u-CXmZKccC_OaPi4-i3AyTDJpzlOt7TnDW78FM2qk18RymajDmCtST/exec";

let waterData = [];
let map, markersGroup;
let pieChartInstance = null;
let barChartInstance = null;
let selectedWaterItem = null;
let mapColorMode = 'raw'; // 'raw' = ปริมาณน้ำดิบคงเหลือ (วัน), 'percent' = ความจุน้ำ (%)

// ค่าคาดการณ์ที่ห่างจากวันนี้เกินกว่านี้ถือว่าข้อมูลต้นทางน่าจะผิดปกติ (10 ปี)
const FORECAST_MAX_REASONABLE_DAYS = 3650;

// ==========================================
// Helper Function: แปลงวันที่เป็นภาษาไทย (เช่น 21 กันยายน 2574)
// ==========================================
function formatThaiDate(dateStr) {
  if (!dateStr || dateStr === 'ไม่ระบุ') return 'ไม่ระบุ';
  
  // แปลง ISO String หรือ Text Date เป็น Date Object
  const date = new Date(dateStr);
  
  // ถ้าพาร์สวันที่ไม่ได้ (กรณีข้อความไม่ใช่วันที่) ให้ส่งค่าเดิมกลับไป
  if (isNaN(date.getTime())) return dateStr;

  const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  const day = date.getUTCDate(); // ใช้ UTC Date ป้องกันเรื่อง timezone เลื่อนวัน
  const month = thaiMonths[date.getUTCMonth()];
  let year = date.getUTCFullYear();

  // หากปีคริสต์ศักราชหลุดมา ค่อยแปลงเป็น พ.ศ. (ถ้าระดับ 2500+ อยู่แล้วจะไม่บวกซ้ำ)
  if (year < 2400) {
    year += 543;
  }

  return `${day} ${month} ${year}`;
}

// Helper คำนวณสีธีมตามระดับ % (4 ระดับ)
function getStatusTheme(percent) {
  if (percent > 80) {
    return { color: '#0284c7', bgHex: '#0284c7', label: '🔵 อุดมสมบูรณ์', badgeClass: 'badge-normal' };
  } else if (percent >= 51) {
    return { color: '#10b981', bgHex: '#10b981', label: '🟢 ปกติ', badgeClass: 'badge-normal' };
  } else if (percent >= 30) {
    return { color: '#f59e0b', bgHex: '#f59e0b', label: '🟡 เฝ้าระวัง', badgeClass: 'badge-warning' };
  } else {
    return { color: '#ef4444', bgHex: '#ef4444', label: '🔴 วิกฤต', badgeClass: 'badge-critical' };
  }
}

// Helper คำนวณสีธีมตามจำนวนวันน้ำดิบคงเหลือ (4 ระดับ)
function getStatusThemeByDays(days) {
  if (days === null || days === undefined || isNaN(days)) {
    return { color: '#94a3b8', bgHex: '#94a3b8', label: '⚪ ไม่ระบุ', badgeClass: 'badge-normal' };
  } else if (days > 360) {
    return { color: '#0284c7', bgHex: '#0284c7', label: '🔵 มากกว่า 360 วัน', badgeClass: 'badge-normal' };
  } else if (days >= 211) {
    return { color: '#10b981', bgHex: '#10b981', label: '🟢 211-360 วัน', badgeClass: 'badge-normal' };
  } else if (days >= 121) {
    return { color: '#f59e0b', bgHex: '#f59e0b', label: '🟡 121-210 วัน', badgeClass: 'badge-warning' };
  } else {
    return { color: '#ef4444', bgHex: '#ef4444', label: '🔴 น้อยกว่า 120 วัน', badgeClass: 'badge-critical' };
  }
}

// ธีมสำหรับจุดที่ข้อมูลวันที่คาดการณ์จากชีตต้นทางน่าจะผิดปกติ
function getFlaggedTheme() {
  return { color: '#94a3b8', bgHex: '#94a3b8', label: '⚠️ ข้อมูลวันที่คาดการณ์ผิดปกติ', badgeClass: 'badge-flagged' };
}

// เลือกธีมสีสำหรับ Marker บนแผนที่ ตามโหมดที่ผู้ใช้เลือก (mapColorMode)
function getMapMarkerTheme(item) {
  if (mapColorMode === 'raw') {
    if (!item.forecastValid) return getFlaggedTheme();
    return getStatusThemeByDays(item.daysRemaining);
  }
  return getStatusTheme(item.percent);
}

// ==========================================
// Initialization เมื่อโหลด DOM
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('Water Dashboard Ready');
  
  initMap();
  fetchData();
  setupEventListeners();

  // ตั้งเวลา Refresh ข้อมูลอัตโนมัติทุก 5 นาที (300,000 ms)
  setInterval(() => {
    fetchData();
  }, 300000);
});

// ==========================================
// 1. การดึงข้อมูลจาก API
// ==========================================
async function fetchData() {
  try {
    const response = await fetch(API_URL);
    const data = await response.json();
    
    // แปลงโครงสร้าง key และล้างข้อมูล
    waterData = data.map(item => {
      const current = Number(item.current) || 0;
      const max = Number(item.max) || 0;
      const min = Number(item.min) || 0;
      
      let percent = 0;
      if (item.percent) {
        percent = parseFloat(String(item.percent).replace('%', ''));
      } else if (max > 0) {
        percent = Math.round((current / max) * 100);
      }

      // ดึงค่าคาดการณ์วันที่น้ำหมด และจัดการจัดรูปแบบวันที่ไทย
      const rawForecast = item.forecast || item.Forecast || 'ไม่ระบุ';
      const forecastVal = formatThaiDate(rawForecast);

      // คำนวณจำนวนวันที่น้ำดิบคงเหลือ จากวันที่คาดการณ์
      const forecastDateObj = new Date(rawForecast);
      let daysRemaining = null;
      let forecastValid = false;

      if (!isNaN(forecastDateObj.getTime())) {
        // ชีตต้นทางบางแถวบันทึกปี พ.ศ. ตรงๆ ลงใน ISO string (เช่น "2575-...")
        // ซึ่ง JS จะตีความเป็นปี ค.ศ. 2575 ทำให้ห่างจากปัจจุบันหลายร้อยปีโดยไม่ตั้งใจ
        // จึงต้องแปลงกลับเป็นปี ค.ศ. จริงก่อนคำนวณจำนวนวัน (ใช้เกณฑ์เดียวกับ formatThaiDate)
        const correctedDate = new Date(forecastDateObj);
        if (correctedDate.getUTCFullYear() >= 2400) {
          correctedDate.setUTCFullYear(correctedDate.getUTCFullYear() - 543);
        }
        daysRemaining = Math.ceil((correctedDate - new Date()) / (1000 * 60 * 60 * 24));
        // วันที่คาดการณ์ที่ยังติดลบ (ผ่านไปแล้ว) หรือไกลเกินจริง ถือว่าข้อมูลต้นทางน่าจะผิดปกติ
        forecastValid = daysRemaining >= 0 && daysRemaining <= FORECAST_MAX_REASONABLE_DAYS;
      }

      return {
        name: item.name || 'ไม่ระบุชื่อ',
        branch: item.branch || 'ไม่ระบุสาขา',
        lat: parseFloat(item.latitude),
        lng: parseFloat(item.longitude),
        max: max,
        min: min,
        current: current,
        percent: percent,
        production: Number(item.production) || 0,
        demand: Number(item.demand) || 0,
        forecast: forecastVal,
        forecastRaw: rawForecast,
        daysRemaining: daysRemaining,
        forecastValid: forecastValid
      };
    }).filter(d => !isNaN(d.lat) && !isNaN(d.lng));

    updateDashboard();
    updateLastUpdatedTime();
  } catch (error) {
    console.error('Error fetching water data:', error);
  }
}

// อัปเดตเวลาอัปเดตล่าสุด
function updateLastUpdatedTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById('update-time').innerText = `${dateStr} ${timeStr} น.`;
}

// ==========================================
// 2. การอัปเดตองค์ประกอบของ Dashboard
// ==========================================
function updateDashboard() {
  updateCards();
  renderMapMarkers();
  renderTable(waterData);
  renderCharts();
}

// Count Up Animation
function animateCount(elementId, targetValue) {
  const elem = document.getElementById(elementId);
  let start = 0;
  const duration = 1000;
  const stepTime = 20;
  const steps = duration / stepTime;
  const increment = targetValue / steps;

  const timer = setInterval(() => {
    start += increment;
    if (start >= targetValue) {
      elem.innerText = targetValue.toLocaleString();
      clearInterval(timer);
    } else {
      elem.innerText = Math.floor(start).toLocaleString();
    }
  }, stepTime);
}

function updateCards() {
  const total = waterData.length;
  const critical = waterData.filter(d => d.percent < 30).length;
  const flagged = waterData.filter(d => !d.forecastValid).length;

  animateCount('total-count', total);
  animateCount('critical-count', critical);
  animateCount('flagged-count', flagged);
}

// ==========================================
// 3. ระบบแผนที่ (Leaflet.js)
// ==========================================
function initMap() {
  map = L.map('map').setView([15.2294, 104.8576], 10);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  markersGroup = L.layerGroup().addTo(map);
}

function renderMapMarkers() {
  markersGroup.clearLayers();

  waterData.forEach(item => {
    const status = getMapMarkerTheme(item);

    const marker = L.circleMarker([item.lat, item.lng], {
      radius: 9,
      fillColor: status.bgHex,
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9,
      dashArray: item.forecastValid ? null : '3, 3'
    });

    marker.bindTooltip(item.name + (item.forecastValid ? '' : ' ⚠️'), {
      permanent: true,
      direction: 'top',
      className: item.forecastValid ? 'map-label' : 'map-label map-label-flagged',
      offset: [0, -8]
    });

    const forecastWarning = item.forecastValid
      ? ''
      : `<tr><td colspan="2" style="color:#b45309; background:rgba(245,158,11,0.12); border-radius:4px;">⚠️ วันที่คาดการณ์นี้ดูผิดปกติ (ค่าดิบ: ${item.forecastRaw}) ควรตรวจสอบกับข้อมูลต้นทาง</td></tr>`;

    const popupContent = `
      <div style="font-family: 'Sarabun', sans-serif; min-width:240px;">
        <h4 style="margin-bottom:8px; color:#0f172a; border-bottom:2px solid #0284c7; padding-bottom:4px;">${item.name}</h4>
        <table class="popup-table">
          <tr><td>สาขาที่ให้บริการ</td><td>${item.branch}</td></tr>
          <tr><td>ความจุสูงสุด,ระดับสูงสุด</td><td>${item.max.toLocaleString()} ลบ.ม.,ม.</td></tr>
          <tr><td>ความจุต่ำสุด,ระดับต่ำสุด</td><td>${item.min.toLocaleString()} ลบ.ม.,ม.</td></tr>
          <tr><td>ความจุน้ำปัจจุบัน,ระดับน้ำปัจจุบัน</td><td>${item.current.toLocaleString()} ลบ.ม.,ม.</td></tr>
          <tr><td>เปอร์เซ็นต์แหล่งน้ำ</td><td><strong>${item.percent}%</strong></td></tr>
          <tr><td>ปริมาณน้ำดิบคงเหลือโดยประมาณ</td><td><strong>${item.forecastValid ? item.daysRemaining.toLocaleString() + ' วัน' : 'ไม่ระบุ (ข้อมูลผิดปกติ)'}</strong></td></tr>
          <tr><td>คาดว่าใช้ได้ถึง</td><td><strong>${item.forecast}</strong></td></tr>
          <tr><td>กำลังการผลิต</td><td>${item.production.toLocaleString()} ลบ.ม./ชม.</td></tr>
          <tr><td>ความต้องการใช้น้ำ</td><td>${item.demand.toLocaleString()} คน</td></tr>
          ${forecastWarning}
        </table>
      </div>
    `;

    marker.bindPopup(popupContent);
    markersGroup.addLayer(marker);

    item._marker = marker;
  });
}

function focusOnMap(item) {
  if (item && item._marker) {
    document.getElementById('map-section').scrollIntoView({ behavior: 'smooth' });
    map.setView([item.lat, item.lng], 13);
    setTimeout(() => {
      item._marker.openPopup();
    }, 400);
  }
}

// ==========================================
// 4. ตารางข้อมูล
// ==========================================
function renderTable(data) {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">ไม่พบข้อมูล</td></tr>';
    return;
  }

  data.forEach((item, index) => {
    const status = getStatusTheme(item.percent);
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><strong>${item.name}</strong></td>
      <td>${item.branch}</td>
      <td><strong>${item.percent}%</strong></td>
      <td>${item.current.toLocaleString()}</td>
      <td><strong>${item.forecast}</strong>${item.forecastValid ? '' : ' <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;" title="ข้อมูลวันที่คาดการณ์นี้อาจไม่ถูกต้อง"></i>'}</td>
      <td>${item.production.toLocaleString()}</td>
      <td>${item.demand.toLocaleString()}</td>
      <td><span class="badge ${status.badgeClass}">${status.label}</span></td>
    `;

    tr.addEventListener('click', () => {
      openDetailModal(item);
    });

    tbody.appendChild(tr);
  });
}

// ==========================================
// 5. กราฟสถิติ (Chart.js)
// ==========================================
function renderCharts() {
  // 1. Pie Chart 4 ระดับ
  const abundantCount = waterData.filter(d => d.percent > 80).length;
  const normalCount = waterData.filter(d => d.percent >= 51 && d.percent <= 80).length;
  const warningCount = waterData.filter(d => d.percent >= 30 && d.percent < 51).length;
  const criticalCount = waterData.filter(d => d.percent < 30).length;

  const pieCtx = document.getElementById('pieChart').getContext('2d');
  if (pieChartInstance) pieChartInstance.destroy();

  pieChartInstance = new Chart(pieCtx, {
    type: 'doughnut',
    data: {
      labels: ['อุดมสมบูรณ์ (>80%)', 'ปกติ (51-80%)', 'เฝ้าระวัง (30-50%)', 'วิกฤต (<30%)'],
      datasets: [{
        data: [abundantCount, normalCount, warningCount, criticalCount],
        backgroundColor: ['#0284c7', '#10b981', '#f59e0b', '#ef4444']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Sarabun' } } }
      }
    }
  });

  // 2. Bar Chart
  const labels = waterData.map(d => d.name);
  const percentValues = waterData.map(d => d.percent);
  const barColors = waterData.map(d => getStatusTheme(d.percent).bgHex);

  const barCtx = document.getElementById('barChart').getContext('2d');
  if (barChartInstance) barChartInstance.destroy();

  barChartInstance = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'เปอร์เซ็นต์น้ำคงเหลือ (%)',
        data: percentValues,
        backgroundColor: barColors,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, max: 100 },
        x: { ticks: { font: { family: 'Sarabun' } } }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// ==========================================
// 6. Modals และ Event Handlers
// ==========================================
function setupEventListeners() {
  document.getElementById('card-total').addEventListener('click', () => {
    openListModal('รายการแหล่งน้ำทั้งหมด', waterData);
  });

  document.getElementById('card-critical').addEventListener('click', () => {
    const criticalList = waterData.filter(d => d.percent < 30);
    openListModal('รายการแหล่งน้ำวิกฤต (< 30%)', criticalList);
  });

  document.getElementById('card-flagged').addEventListener('click', () => {
    const flaggedList = waterData.filter(d => !d.forecastValid);
    openListModal('รายการที่ข้อมูลวันที่คาดการณ์ผิดปกติ', flaggedList);
  });

  const handleSearch = () => {
    const query = document.getElementById('search-input').value.trim().toLowerCase();
    if (!query) {
      renderTable(waterData);
      return;
    }

    const matched = waterData.filter(d => 
      d.name.toLowerCase().includes(query) || d.branch.toLowerCase().includes(query)
    );

    if (matched.length > 0) {
      renderTable(matched);
      focusOnMap(matched[0]);
    } else {
      alert('ไม่พบข้อมูลตามคำค้นหา');
    }
  };

  document.getElementById('search-btn').addEventListener('click', handleSearch);
  document.getElementById('search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  document.getElementById('sort-name').addEventListener('click', () => {
    const sorted = [...waterData].sort((a, b) => a.name.localeCompare(b.name, 'th'));
    renderTable(sorted);
  });

  document.getElementById('sort-percent').addEventListener('click', () => {
    const sorted = [...waterData].sort((a, b) => a.percent - b.percent);
    renderTable(sorted);
  });

  document.querySelectorAll('#map-color-toggle .btn-sort').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === mapColorMode) return;
      mapColorMode = btn.dataset.mode;
      document.querySelectorAll('#map-color-toggle .btn-sort').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMapMarkers();
    });
  });

  document.getElementById('btn-show-map').addEventListener('click', () => {
    if (selectedWaterItem) {
      closeAllModals();
      focusOnMap(selectedWaterItem);
    }
  });

  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });
}

function openListModal(title, items) {
  document.getElementById('modal-list-title').innerText = title;
  const container = document.getElementById('modal-list-container');
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<p class="text-center">ไม่มีข้อมูลรายการ</p>';
  } else {
    items.forEach(item => {
      const status = getStatusTheme(item.percent);
      const div = document.createElement('div');
      div.className = 'modal-list-item';
      div.innerHTML = `
        <div>
          <strong>${item.name}</strong>${item.forecastValid ? '' : ' <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;" title="ข้อมูลวันที่คาดการณ์นี้อาจไม่ถูกต้อง"></i>'}
          <br><small style="color:#64748b;">${item.branch}</small>
        </div>
        <div>
          <span class="badge ${status.badgeClass}">${item.percent}%</span>
        </div>
      `;
      div.addEventListener('click', () => {
        closeAllModals();
        openDetailModal(item);
      });
      container.appendChild(div);
    });
  }

  document.getElementById('list-modal').style.display = 'flex';
}

function openDetailModal(item) {
  selectedWaterItem = item;
  const status = getStatusTheme(item.percent);
  const container = document.getElementById('detail-modal-body');

  container.innerHTML = `
    <table class="detail-table">
      <tr><td>ชื่อแหล่งน้ำ:</td><td><strong>${item.name}</strong></td></tr>
      <tr><td>สาขาที่ให้บริการ:</td><td>${item.branch}</td></tr>
      <tr><td>สถานะความจุ:</td><td><span class="badge ${status.badgeClass}">${status.label} (${item.percent}%)</span></td></tr>
      <tr><td>ปริมาณน้ำสูงสุด,ระดับน้ำสูงสุด (Max):</td><td>${item.max.toLocaleString()} ลบ.ม.,ม.</td></tr>
      <tr><td>ปริมาณน้ำต่ำสุด,ระดับน้ำต่ำสุด (Min):</td><td>${item.min.toLocaleString()} ลบ.ม.,ม.</td></tr>
      <tr><td>ปริมาณน้ำปัจจุบัน,ระดับน้ำปัจจุบัน (Current):</td><td>${item.current.toLocaleString()} ลบ.ม.,ม.</td></tr>
      <tr><td>ปริมาณน้ำดิบคงเหลือโดยประมาณ:</td><td><strong>${item.forecastValid ? item.daysRemaining.toLocaleString() + ' วัน' : 'ไม่ระบุ (ข้อมูลผิดปกติ)'}</strong></td></tr>
      <tr><td>คาดการณ์สูบน้ำดิบได้ถึง (Forecast):</td><td><strong>${item.forecast}</strong></td></tr>
      <tr><td>กำลังการผลิต:</td><td>${item.production.toLocaleString()} ลบ.ม./ชม.</td></tr>
      <tr><td>ความต้องการใช้น้ำ:</td><td>${item.demand.toLocaleString()} คน</td></tr>
      <tr><td>พิกัดทางภูมิศาสตร์:</td><td>${item.lat}, ${item.lng}</td></tr>
      ${item.forecastValid ? '' : `<tr><td colspan="2" style="color:#b45309; background:rgba(245,158,11,0.12); border-radius:4px;">⚠️ วันที่คาดการณ์ต้นทาง (ค่าดิบ: ${item.forecastRaw}) ดูผิดปกติ ควรตรวจสอบและแก้ไขในชีตข้อมูล</td></tr>`}
    </table>
  `;

  document.getElementById('detail-modal').style.display = 'flex';
}

function closeAllModals() {
  document.getElementById('list-modal').style.display = 'none';
  document.getElementById('detail-modal').style.display = 'none';
}