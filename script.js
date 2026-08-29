// ==========================================
// การตั้งค่าหลักและการระบุตัวแปร
// ==========================================
const API_URL = "https://script.google.com/macros/s/AKfycbwdXY5dvT9RR3u-CXmZKccC_OaPi4-i3AyTDJpzlOt7TnDW78FM2qk18RymajDmCtST/exec";

let waterData = [];
let map, markersGroup;
let pieChartInstance = null;
let droughtWatchChartInstance = null;
let reservoirChartInstance = null;
let riverChartInstance = null;
let selectedWaterItem = null;
let printRestoreState = null; // สถานะสำหรับกู้คืนหลังพิมพ์เสร็จ
let mapColorMode = 'raw'; // 'raw' = ปริมาณน้ำดิบคงเหลือ (วัน), 'percent' = ความจุน้ำ (%)
let currentTableData = [];
let currentPage = 1;
let pageSize = 10; // จำนวน, หรือ 'all'

// นิยามตัวเลือกของตัวกรองแบบ Excel ในแต่ละคอลัมน์
// type 'checkbox' = เลือกจากรายการค่าที่มีอยู่, type 'range' = กรองด้วยช่วงตัวเลข (ต่ำสุด/สูงสุด)
const TABLE_COLUMN_FILTERS = {
  name: {
    type: 'checkbox',
    getValue: (d) => d.name,
    getOptions: () => [...new Set(waterData.map((d) => d.name))]
      .sort((a, b) => a.localeCompare(b, 'th'))
      .map((n) => ({ value: n, label: n }))
  },
  branch: {
    type: 'checkbox',
    getValue: (d) => d.branch,
    getOptions: () => [...new Set(waterData.map((d) => d.branch))]
      .sort((a, b) => a.localeCompare(b, 'th'))
      .map((b) => ({ value: b, label: b }))
  },
  percent: {
    type: 'range',
    getValue: (d) => d.percent
  },
  current: {
    type: 'range',
    getValue: (d) => d.current
  },
  daysRemaining: {
    type: 'range',
    getValue: (d) => (d.forecastValid ? d.daysRemaining : NaN)
  },
  production: {
    type: 'range',
    getValue: (d) => d.production
  },
  demand: {
    type: 'range',
    getValue: (d) => d.demand
  },
  status: {
    type: 'checkbox',
    getValue: (d) => getPercentTier(d.percent),
    getOptions: () => [
      { value: 'abundant', label: 'อุดมสมบูรณ์ (มากกว่า 80%)' },
      { value: 'normal', label: 'ปกติ (51% - 80%)' },
      { value: 'warning', label: 'เฝ้าระวัง (30% - 50%)' },
      { value: 'critical', label: 'วิกฤต (น้อยกว่า 30%)' }
    ]
  },
  forecast: {
    type: 'checkbox',
    getValue: (d) => (d.forecastValid ? 'valid' : 'flagged'),
    getOptions: () => [
      { value: 'valid', label: 'ปกติ' },
      { value: 'flagged', label: 'ผิดปกติ' }
    ]
  }
};

// ค่าตัวกรองเริ่มต้นของคอลัมน์หนึ่ง ๆ ตามชนิดตัวกรอง
function getDefaultColumnFilterValue(column) {
  return TABLE_COLUMN_FILTERS[column].type === 'range' ? { min: null, max: null } : new Set();
}

function buildDefaultColumnFilters() {
  const filters = {};
  Object.keys(TABLE_COLUMN_FILTERS).forEach((column) => {
    filters[column] = getDefaultColumnFilterValue(column);
  });
  return filters;
}

// สถานะตัวกรองตารางข้อมูล (columnFilters: checkbox เก็บ "ค่าที่ถูกตัดออก", range เก็บ {min,max}; ว่าง/null หมายถึงไม่กรอง)
let tableFilterState = {
  search: '',
  sortBy: 'daysRemaining', // null | 'name' | 'percent' | 'daysRemaining'
  columnFilters: buildDefaultColumnFilters()
};

// ค่าคาดการณ์ที่ห่างจากวันนี้เกินกว่านี้ถือว่าข้อมูลต้นทางน่าจะผิดปกติ (10 ปี)
const FORECAST_MAX_REASONABLE_DAYS = 3650;

// คำอธิบายเกณฑ์สีของแต่ละโหมด สำหรับแสดงเป็น Legend ใต้แผนที่
const MAP_LEGEND_ITEMS = {
  raw: [
    { color: '#0284c7', label: 'มากกว่า 360 วัน' },
    { color: '#10b981', label: '211 - 360 วัน' },
    { color: '#f59e0b', label: '121 - 210 วัน' },
    { color: '#ef4444', label: 'น้อยกว่า 120 วัน' },
    { color: '#94a3b8', label: 'ข้อมูลวันที่คาดการณ์ผิดปกติ', flagged: true }
  ],
  percent: [
    { color: '#0284c7', label: 'อุดมสมบูรณ์ (มากกว่า 80%)' },
    { color: '#10b981', label: 'ปกติ (51% - 80%)' },
    { color: '#f59e0b', label: 'เฝ้าระวัง (30% - 50%)' },
    { color: '#ef4444', label: 'วิกฤต (น้อยกว่า 30%)' }
  ]
};

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

// คีย์ระดับความจุ ใช้กับตัวกรองสถานะในตาราง (ต่างจาก badgeClass ที่ใช้ร่วมกัน 2 ระดับ)
function getPercentTier(percent) {
  if (percent > 80) return 'abundant';
  if (percent >= 51) return 'normal';
  if (percent >= 30) return 'warning';
  return 'critical';
}

// Helper คำนวณสีธีมตามจำนวนวันน้ำดิบคงเหลือ (4 ระดับ)
// label = คำอธิบายช่วงวัน (ใช้กับ legend/popup ที่ต้องอธิบายเกณฑ์)
// shortLabel = คำสั้นบอกสถานะ (ใช้กับ badge ที่มีสีบอกอยู่แล้ว ไม่ต้องพิมพ์ช่วงวันซ้ำ)
function getStatusThemeByDays(days) {
  if (days === null || days === undefined || isNaN(days)) {
    return { color: '#94a3b8', bgHex: '#94a3b8', label: '⚪ ไม่ระบุ', shortLabel: '⚪ ไม่ระบุ', badgeClass: 'badge-normal' };
  } else if (days > 360) {
    return { color: '#0284c7', bgHex: '#0284c7', label: '🔵 มากกว่า 360 วัน', shortLabel: '🔵 อุดมสมบูรณ์', badgeClass: 'badge-normal' };
  } else if (days >= 211) {
    return { color: '#10b981', bgHex: '#10b981', label: '🟢 211-360 วัน', shortLabel: '🟢 ปกติ', badgeClass: 'badge-normal' };
  } else if (days >= 121) {
    return { color: '#f59e0b', bgHex: '#f59e0b', label: '🟡 121-210 วัน', shortLabel: '🟡 เฝ้าระวัง', badgeClass: 'badge-warning' };
  } else {
    return { color: '#ef4444', bgHex: '#ef4444', label: '🔴 น้อยกว่า 120 วัน', shortLabel: '🔴 วิกฤต', badgeClass: 'badge-critical' };
  }
}

// ธีมสำหรับจุดที่ข้อมูลวันที่คาดการณ์จากชีตต้นทางน่าจะผิดปกติ
function getFlaggedTheme() {
  return { color: '#94a3b8', bgHex: '#94a3b8', label: '⚠️ ข้อมูลวันที่คาดการณ์ผิดปกติ', shortLabel: '⚠️ ผิดปกติ', badgeClass: 'badge-flagged' };
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
  renderDroughtOverviewCharts();

  // ตั้งเวลา Refresh ข้อมูลอัตโนมัติทุก 5 นาที (300,000 ms)
  setInterval(() => {
    fetchData();
  }, 300000);

  // กู้คืนสถานะหลังพิมพ์เสร็จ (afterprint ใช้ไม่ได้ในบางเบราว์เซอร์ จึงใช้ matchMedia คู่กันไว้)
  window.addEventListener('afterprint', restoreAfterPrint);
  if (window.matchMedia) {
    window.matchMedia('print').addEventListener('change', (mql) => {
      if (!mql.matches) restoreAfterPrint();
    });
  }
});

// ==========================================
// 1. การดึงข้อมูลจาก API
// ==========================================
async function fetchData() {
  document.getElementById('fetch-spinner').classList.add('active');

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
  } finally {
    document.getElementById('fetch-spinner').classList.remove('active');
    document.getElementById('loading-overlay').classList.add('hidden');
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
  Object.keys(TABLE_COLUMN_FILTERS).forEach(populateColumnFilterPanel);
  applyTableFilters(); // วาดตาราง + แผนที่ ตามตัวกรองปัจจุบัน
  renderCharts();
}

// รวมตัวกรองค้นหา/คอลัมน์ (สาขา/สถานะ/ข้อมูลผิดปกติ) และการเรียงลำดับ แล้ววาดตาราง
function applyTableFilters() {
  let filtered = waterData.filter(d => {
    const matchesSearch = !tableFilterState.search ||
      d.name.toLowerCase().includes(tableFilterState.search) ||
      d.branch.toLowerCase().includes(tableFilterState.search);

    const matchesColumns = Object.keys(TABLE_COLUMN_FILTERS).every((column) => {
      const config = TABLE_COLUMN_FILTERS[column];
      const filterValue = tableFilterState.columnFilters[column];

      if (config.type === 'range') {
        const value = config.getValue(d);
        const filterActive = filterValue.min !== null || filterValue.max !== null;
        if (filterActive && isNaN(value)) return false;
        if (filterValue.min !== null && value < filterValue.min) return false;
        if (filterValue.max !== null && value > filterValue.max) return false;
        return true;
      }

      if (filterValue.size === 0) return true;
      return !filterValue.has(config.getValue(d));
    });

    return matchesSearch && matchesColumns;
  });

  if (tableFilterState.sortBy === 'name') {
    filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'th'));
  } else if (tableFilterState.sortBy === 'percent') {
    filtered = [...filtered].sort((a, b) => a.percent - b.percent);
  } else if (tableFilterState.sortBy === 'daysRemaining') {
    // เรียงจากน้ำดิบคงเหลือน้อยที่สุด (เร่งด่วนที่สุด) ไปมากที่สุด รายการที่ข้อมูลคาดการณ์ผิดปกติจะอยู่ท้ายสุด
    filtered = [...filtered].sort((a, b) => {
      const aVal = a.forecastValid ? a.daysRemaining : Infinity;
      const bVal = b.forecastValid ? b.daysRemaining : Infinity;
      return aVal - bVal;
    });
  }

  renderTable(filtered);
  renderMapMarkers();
  return filtered;
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
  const watchBranches = new Set(getWatchTierItems().map(d => d.branch)).size;

  animateCount('total-count', total);
  animateCount('critical-count', critical);
  animateCount('flagged-count', flagged);
  animateCount('watch-branches-count', watchBranches);
}

// แหล่งน้ำที่อยู่ในเกณฑ์เฝ้าระวังตามปริมาณน้ำดิบคงเหลือ (121-210 วัน) นับเฉพาะข้อมูลคาดการณ์ที่ไม่ผิดปกติ
function getWatchTierItems() {
  return waterData.filter(d => d.forecastValid && d.daysRemaining >= 121 && d.daysRemaining <= 210);
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

// แสดงคำอธิบายเกณฑ์สีของโหมดที่กำลังเลือกอยู่ใต้แผนที่
function renderMapLegend() {
  const container = document.getElementById('map-legend');
  const items = MAP_LEGEND_ITEMS[mapColorMode];

  container.innerHTML = items.map(item => `
    <div class="legend-item">
      <span class="legend-swatch${item.flagged ? ' legend-swatch-flagged' : ''}" style="background:${item.color};"></span>
      <span>${item.label}</span>
    </div>
  `).join('');
}

// วาดหมุดบนแผนที่ตามข้อมูลที่ผ่านตัวกรองตาราง (currentTableData) ไม่ใช่ waterData ทั้งหมด
function renderMapMarkers() {
  markersGroup.clearLayers();
  renderMapLegend();

  currentTableData.forEach(item => {
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
  if (!item) return;

  // แผนที่แสดงเฉพาะข้อมูลที่ผ่านตัวกรองตาราง จุดนี้อาจไม่มีหมุดอยู่บนแผนที่ในขณะนี้
  if (!item._marker || !map.hasLayer(item._marker)) {
    alert('รายการนี้ไม่แสดงบนแผนที่ในขณะนี้ เนื่องจากถูกซ่อนโดยตัวกรองตารางที่ใช้อยู่ กรุณาล้างตัวกรองก่อน');
    return;
  }

  if (document.getElementById('map-section').classList.contains('map-hidden')) {
    setMapSize('medium');
  }
  document.getElementById('map-section').scrollIntoView({ behavior: 'smooth' });
  map.setView([item.lat, item.lng], 13);
  setTimeout(() => {
    item._marker.openPopup();
  }, 400);
}

// ==========================================
// 3b. ตัวกรองคอลัมน์แบบ Excel ในหัวตาราง
// ==========================================

// เติมข้อมูลในแผงตัวกรองของคอลัมน์ที่ระบุ: checkbox ทั้งหมดจะถูกติ๊กตามค่าที่ไม่ได้ถูกตัดออก
// ส่วน range จะเติมค่าต่ำสุด/สูงสุดปัจจุบัน และแสดงช่วงข้อมูลจริงเป็น placeholder
function populateColumnFilterPanel(column) {
  const panel = document.querySelector(`.th-filter-panel[data-panel="${column}"]`);
  if (!panel) return;

  const config = TABLE_COLUMN_FILTERS[column];
  const filterValue = tableFilterState.columnFilters[column];

  if (config.type === 'range') {
    const minInput = panel.querySelector('.th-filter-min');
    const maxInput = panel.querySelector('.th-filter-max');
    minInput.value = filterValue.min ?? '';
    maxInput.value = filterValue.max ?? '';

    const values = waterData.map(config.getValue).filter((v) => !isNaN(v));
    if (values.length > 0) {
      minInput.placeholder = `ต่ำสุด (${Math.min(...values).toLocaleString()})`;
      maxInput.placeholder = `สูงสุด (${Math.max(...values).toLocaleString()})`;
    }

    updateColumnFilterButtonState(column);
    return;
  }

  const optionsContainer = panel.querySelector('.th-filter-options');
  const options = config.getOptions();

  optionsContainer.innerHTML = options.map(opt => `
    <label class="th-filter-option">
      <input type="checkbox" value="${opt.value}" ${filterValue.has(opt.value) ? '' : 'checked'}>
      <span>${opt.label}</span>
    </label>
  `).join('');

  updateSelectAllCheckbox(panel);
  updateColumnFilterButtonState(column);
}

function updateSelectAllCheckbox(panel) {
  const checkboxes = [...panel.querySelectorAll('.th-filter-options input[type="checkbox"]')];
  const allCheckbox = panel.querySelector('.th-filter-all input');
  allCheckbox.checked = checkboxes.length > 0 && checkboxes.every(cb => cb.checked);
}

function updateColumnFilterButtonState(column) {
  const btn = document.querySelector(`.th-filter-btn[data-column="${column}"]`);
  if (!btn) return;
  const config = TABLE_COLUMN_FILTERS[column];
  const filterValue = tableFilterState.columnFilters[column];
  const isActive = config.type === 'range'
    ? (filterValue.min !== null || filterValue.max !== null)
    : filterValue.size > 0;
  btn.classList.toggle('active', isActive);
}

function closeAllFilterPanels() {
  document.querySelectorAll('.th-filter-panel.open').forEach(p => p.classList.remove('open'));
}

function setupColumnFilters() {
  document.querySelectorAll('.th-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const column = btn.dataset.column;
      const panel = document.querySelector(`.th-filter-panel[data-panel="${column}"]`);
      const isOpen = panel.classList.contains('open');
      closeAllFilterPanels();
      if (!isOpen) {
        populateColumnFilterPanel(column);
        panel.classList.add('open');
      }
    });
  });

  document.querySelectorAll('.th-filter-panel').forEach(panel => {
    const column = panel.dataset.panel;
    const config = TABLE_COLUMN_FILTERS[column];

    panel.addEventListener('click', (e) => e.stopPropagation());

    if (config.type === 'range') {
      panel.querySelectorAll('input[type="number"]').forEach(input => {
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') panel.querySelector('.th-filter-apply').click();
        });
      });
    } else {
      const searchInput = panel.querySelector('.th-filter-search');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          const query = searchInput.value.trim().toLowerCase();
          panel.querySelectorAll('.th-filter-option').forEach(label => {
            const text = label.querySelector('span').innerText.toLowerCase();
            label.style.display = text.includes(query) ? '' : 'none';
          });
        });
      }

      panel.querySelector('.th-filter-all input').addEventListener('change', (e) => {
        panel.querySelectorAll('.th-filter-options input[type="checkbox"]').forEach(cb => {
          cb.checked = e.target.checked;
        });
      });

      panel.querySelector('.th-filter-options').addEventListener('change', (e) => {
        if (e.target.matches('input[type="checkbox"]')) updateSelectAllCheckbox(panel);
      });
    }

    panel.querySelector('.th-filter-apply').addEventListener('click', () => {
      if (config.type === 'range') {
        const minVal = panel.querySelector('.th-filter-min').value;
        const maxVal = panel.querySelector('.th-filter-max').value;
        tableFilterState.columnFilters[column] = {
          min: minVal === '' ? null : parseFloat(minVal),
          max: maxVal === '' ? null : parseFloat(maxVal)
        };
      } else {
        const excluded = new Set();
        panel.querySelectorAll('.th-filter-options input[type="checkbox"]').forEach(cb => {
          if (!cb.checked) excluded.add(cb.value);
        });
        tableFilterState.columnFilters[column] = excluded;
      }
      updateColumnFilterButtonState(column);
      closeAllFilterPanels();
      applyTableFilters();
    });

    panel.querySelector('.th-filter-clear').addEventListener('click', () => {
      tableFilterState.columnFilters[column] = getDefaultColumnFilterValue(column);
      populateColumnFilterPanel(column);
      updateColumnFilterButtonState(column);
      closeAllFilterPanels();
      applyTableFilters();
    });
  });

  document.addEventListener('click', closeAllFilterPanels);
}

// ==========================================
// 4. ตารางข้อมูล
// ==========================================
function renderTable(data) {
  currentTableData = data;
  currentPage = 1;
  renderTablePage();
}

function renderTablePage() {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  const total = currentTableData.length;

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center">ไม่พบข้อมูล</td></tr>';
    renderPaginationControls(0, 0, 0, 1);
    return;
  }

  const effectivePageSize = pageSize === 'all' ? total : pageSize;
  const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);

  const startIdx = (currentPage - 1) * effectivePageSize;
  const endIdx = Math.min(startIdx + effectivePageSize, total);
  const pageData = currentTableData.slice(startIdx, endIdx);

  pageData.forEach((item, index) => {
    // สถานะคอลัมน์สุดท้ายอิงตามปริมาณน้ำดิบคงเหลือ (วัน) เกณฑ์เดียวกับที่ใช้บนแผนที่
    const status = item.forecastValid ? getStatusThemeByDays(item.daysRemaining) : getFlaggedTheme();
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${startIdx + index + 1}</td>
      <td><strong>${item.name}</strong></td>
      <td>${item.branch}</td>
      <td><strong>${item.percent}%</strong></td>
      <td>${item.current.toLocaleString()}</td>
      <td><strong>${item.forecast}</strong>${item.forecastValid ? '' : ' <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;" title="ข้อมูลวันที่คาดการณ์นี้อาจไม่ถูกต้อง"></i>'}</td>
      <td>${item.production.toLocaleString()}</td>
      <td>${item.demand.toLocaleString()}</td>
      <td><strong>${item.forecastValid ? item.daysRemaining.toLocaleString() + ' วัน' : 'ไม่ระบุ'}</strong>${item.forecastValid ? '' : ' <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;" title="ข้อมูลวันที่คาดการณ์นี้อาจไม่ถูกต้อง"></i>'}</td>
      <td><span class="badge ${status.badgeClass}">${status.shortLabel}</span></td>
    `;

    tr.addEventListener('click', () => {
      openDetailModal(item);
    });

    tbody.appendChild(tr);
  });

  renderPaginationControls(startIdx, endIdx, total, totalPages);
}

function renderPaginationControls(startIdx, endIdx, total, totalPages) {
  const info = document.getElementById('pagination-info');
  const prevBtn = document.getElementById('pagination-prev');
  const nextBtn = document.getElementById('pagination-next');

  if (total === 0) {
    info.innerText = 'ไม่พบข้อมูล';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  info.innerText = `แสดง ${startIdx + 1}-${endIdx} จาก ${total.toLocaleString()} รายการ (หน้า ${currentPage}/${totalPages})`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
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
        legend: { position: 'bottom', labels: { font: { family: 'Sarabun' } } },
        tooltip: {
          callbacks: {
            title: () => '',
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${ctx.parsed.toLocaleString()} แห่ง (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// ==========================================
// 5b. กราฟภาพรวมสถานการณ์ภัยแล้ง (ข้อมูลสรุปแบบ Static จากรายงาน กปภ.เขต 8)
// ==========================================
function renderDonutChart(canvasId, labels, data, colors) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ data: data, backgroundColor: colors }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Sarabun' }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            title: () => '',
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return `${ctx.label}: ${ctx.parsed.toLocaleString()} แห่ง (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function renderDroughtOverviewCharts() {
  // สาขา/หน่วยบริการที่เฝ้าระวังภัยแล้ง (รวม 20 สาขา + 43 หน่วยบริการ = 63)
  droughtWatchChartInstance = renderDonutChart(
    'droughtWatchChart',
    ['ปกติ', 'เฝ้าระวังด้านปริมาณน้ำ', 'เฝ้าระวังด้านคุณภาพน้ำ', 'เฝ้าระวังด้านคุณภาพและปริมาณ'],
    [58, 2, 2, 1],
    ['#10b981', '#f59e0b', '#38bdf8', '#1e3a8a']
  );

  // แหล่งน้ำดิบหลัก ส่วนอ่างเก็บน้ำ (33 แห่ง)
  reservoirChartInstance = renderDonutChart(
    'reservoirChart',
    ['น้อยกว่า 30%', 'ระหว่าง 30-50%', 'ระหว่าง 51-80%', 'มากกว่า 80%'],
    [8, 13, 9, 3],
    ['#ef4444', '#f59e0b', '#10b981', '#0284c7']
  );

  // แหล่งน้ำดิบหลัก ส่วนลำน้ำ/ลำห้วย (42 แห่ง)
  riverChartInstance = renderDonutChart(
    'riverChart',
    ['น้อยกว่า 30%', 'ระหว่าง 30-50%', 'ระหว่าง 51-80%', 'มากกว่า 80%'],
    [12, 13, 13, 4],
    ['#ef4444', '#f59e0b', '#10b981', '#0284c7']
  );
}

// ==========================================
// 6. Modals และ Event Handlers
// ==========================================
function setupEventListeners() {
  document.getElementById('card-total').addEventListener('click', () => {
    openListModal('รายการแหล่งน้ำทั้งหมด', waterData);
  });

  document.getElementById('card-watch-branches').addEventListener('click', () => {
    openListModal('รายการแหล่งน้ำในสาขาเฝ้าระวัง (ปริมาณน้ำดิบคงเหลือ 121-210 วัน)', getWatchTierItems());
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
    tableFilterState.search = document.getElementById('search-input').value.trim().toLowerCase();
    const filtered = applyTableFilters();

    if (tableFilterState.search) {
      if (filtered.length > 0) {
        focusOnMap(filtered[0]);
      } else {
        alert('ไม่พบข้อมูลตามคำค้นหา');
      }
    }
  };

  document.getElementById('search-btn').addEventListener('click', handleSearch);

  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');

  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  searchInput.addEventListener('input', () => {
    searchClearBtn.style.display = searchInput.value ? '' : 'none';
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchClearBtn.style.display = 'none';
    tableFilterState.search = '';
    applyTableFilters();
    searchInput.focus();
  });

  const setSortBy = (sortBy) => {
    tableFilterState.sortBy = sortBy;
    document.querySelectorAll('#sort-name, #sort-percent, #sort-days').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`sort-${sortBy === 'daysRemaining' ? 'days' : sortBy}`).classList.add('active');
    applyTableFilters();
  };

  document.getElementById('sort-name').addEventListener('click', () => setSortBy('name'));
  document.getElementById('sort-percent').addEventListener('click', () => setSortBy('percent'));
  document.getElementById('sort-days').addEventListener('click', () => setSortBy('daysRemaining'));

  setupColumnFilters();

  document.getElementById('filter-clear-all').addEventListener('click', () => {
    tableFilterState = {
      search: '',
      sortBy: 'daysRemaining',
      columnFilters: buildDefaultColumnFilters()
    };
    document.getElementById('search-input').value = '';
    document.getElementById('search-clear-btn').style.display = 'none';
    document.querySelectorAll('#sort-name, #sort-percent, #sort-days').forEach(btn => btn.classList.remove('active'));
    document.getElementById('sort-days').classList.add('active');
    Object.keys(TABLE_COLUMN_FILTERS).forEach((column) => {
      populateColumnFilterPanel(column);
      updateColumnFilterButtonState(column);
    });
    closeAllFilterPanels();
    applyTableFilters();
  });

  document.getElementById('page-size-select').addEventListener('change', (e) => {
    pageSize = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
    currentPage = 1;
    renderTablePage();
  });

  document.getElementById('pagination-prev').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderTablePage();
    }
  });

  document.getElementById('pagination-next').addEventListener('click', () => {
    const effectivePageSize = pageSize === 'all' ? currentTableData.length : pageSize;
    const totalPages = Math.max(1, Math.ceil(currentTableData.length / effectivePageSize));
    if (currentPage < totalPages) {
      currentPage++;
      renderTablePage();
    }
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

  document.getElementById('map-fullscreen-btn').addEventListener('click', toggleMapFullscreen);
  document.getElementById('map-size-select').addEventListener('change', (e) => setMapSize(e.target.value));

  document.getElementById('print-dashboard-btn').addEventListener('click', printDashboard);
  document.getElementById('print-map-a3-btn').addEventListener('click', printMapA3);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
      if (document.getElementById('map-section').classList.contains('map-fullscreen')) {
        toggleMapFullscreen();
      }
    }
  });
}

// สลับโหมดขยายแผนที่เต็มจอ เพื่อให้ผู้ใช้โฟกัสที่แผนที่ได้
function toggleMapFullscreen() {
  const section = document.getElementById('map-section');
  const btn = document.getElementById('map-fullscreen-btn');

  // ถ้าแผนที่ถูกซ่อนอยู่ ให้แสดงก่อนเข้าโหมดเต็มจอ
  if (section.classList.contains('map-hidden')) {
    setMapSize('medium');
  }

  const isFullscreen = section.classList.toggle('map-fullscreen');

  document.body.style.overflow = isFullscreen ? 'hidden' : '';
  btn.innerHTML = isFullscreen
    ? '<i class="fa-solid fa-compress"></i> ออกจากเต็มจอ'
    : '<i class="fa-solid fa-expand"></i> ขยายแผนที่';

  // Leaflet ต้องคำนวณขนาด container ใหม่หลังเปลี่ยน layout
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 300);
}

// ปรับขนาด/ซ่อนแผนที่ ตามตัวเลือกที่ผู้ใช้เลือก (hidden/small/medium/large)
function setMapSize(size) {
  const section = document.getElementById('map-section');
  const mapCard = document.getElementById('map-card');
  const select = document.getElementById('map-size-select');

  select.value = size;
  section.classList.toggle('map-hidden', size === 'hidden');

  if (size !== 'hidden') {
    mapCard.classList.remove('map-size-small', 'map-size-medium', 'map-size-large');
    mapCard.classList.add(`map-size-${size}`);
    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 300);
  }
}

// ==========================================
// 7. การพิมพ์
// ==========================================
function setPrintPageSize(cssSize) {
  document.getElementById('dynamic-print-page-style').textContent = `@page { size: ${cssSize}; margin: 10mm; }`;
}

// พิมพ์ทั้งแดชบอร์ด (A4 แนวนอน): แสดงข้อมูลตารางครบทุกแถวและปรับกราฟ/แผนที่ให้พร้อมพิมพ์
function printDashboard() {
  setPrintPageSize('A4 landscape');

  const mapWasHidden = document.getElementById('map-section').classList.contains('map-hidden');
  printRestoreState = {
    type: 'dashboard',
    pageSize: pageSize,
    currentPage: currentPage,
    mapWasHidden: mapWasHidden
  };

  if (mapWasHidden) setMapSize('medium');

  pageSize = 'all';
  currentPage = 1;
  renderTablePage();

  setTimeout(() => {
    if (map) map.invalidateSize();
    [pieChartInstance, droughtWatchChartInstance, reservoirChartInstance, riverChartInstance].forEach((chart) => {
      if (chart) chart.resize();
    });
    window.print();
  }, 350);
}

// พิมพ์เฉพาะแผนที่ ขนาด A3 แนวนอน เพื่อให้เห็นรายละเอียดหมุดและป้ายชื่อชัดเจนขึ้น
function printMapA3() {
  setPrintPageSize('A3 landscape');

  const mapWasHidden = document.getElementById('map-section').classList.contains('map-hidden');
  printRestoreState = { type: 'map-a3', mapWasHidden: mapWasHidden };

  if (mapWasHidden) setMapSize('medium');
  document.body.classList.add('printing-map-a3');

  setTimeout(() => {
    if (map) map.invalidateSize();
    window.print();
  }, 350);
}

function restoreAfterPrint() {
  if (!printRestoreState) return;
  const state = printRestoreState;
  printRestoreState = null;

  setPrintPageSize('A4 landscape');

  if (state.type === 'dashboard') {
    pageSize = state.pageSize;
    currentPage = state.currentPage;
    renderTablePage();
  } else if (state.type === 'map-a3') {
    document.body.classList.remove('printing-map-a3');
  }

  if (state.mapWasHidden) setMapSize('hidden');

  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 300);
}

function openListModal(title, items) {
  document.getElementById('modal-list-title').innerText = title;
  const container = document.getElementById('modal-list-container');
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<p class="text-center">ไม่มีข้อมูลรายการ</p>';
  } else {
    items.forEach(item => {
      // สถานะอิงตามปริมาณน้ำดิบคงเหลือ (วัน) เกณฑ์เดียวกับตารางและแผนที่
      const status = item.forecastValid ? getStatusThemeByDays(item.daysRemaining) : getFlaggedTheme();
      const div = document.createElement('div');
      div.className = 'modal-list-item';
      div.innerHTML = `
        <div>
          <strong>${item.name}</strong>${item.forecastValid ? '' : ' <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;" title="ข้อมูลวันที่คาดการณ์นี้อาจไม่ถูกต้อง"></i>'}
          <br><small style="color:#64748b;">${item.branch}</small>
        </div>
        <div>
          <span class="badge ${status.badgeClass}">${status.shortLabel}</span>
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
  // สถานะอิงตามปริมาณน้ำดิบคงเหลือ (วัน) เกณฑ์เดียวกับตารางและแผนที่
  const status = item.forecastValid ? getStatusThemeByDays(item.daysRemaining) : getFlaggedTheme();
  const container = document.getElementById('detail-modal-body');

  container.innerHTML = `
    <table class="detail-table">
      <tr><td>ชื่อแหล่งน้ำ:</td><td><strong>${item.name}</strong></td></tr>
      <tr><td>สาขาที่ให้บริการ:</td><td>${item.branch}</td></tr>
      <tr><td>สถานะ (ปริมาณน้ำดิบคงเหลือ):</td><td><span class="badge ${status.badgeClass}">${status.shortLabel}</span></td></tr>
      <tr><td>% ความจุ:</td><td>${item.percent}%</td></tr>
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