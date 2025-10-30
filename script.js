// script.js
// Quản lý tồn kho từ Excel — bản hoàn chỉnh với Firebase Realtime Database + Error Handling + Fix History + Thêm/Sửa Tồn Kho + Lịch sử nhận hàng + Sắp xếp + Search + Fix Delete + Bộ lọc thời gian cho nhập kho

import { getDatabase, ref, set, get, onValue, push } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

document.addEventListener('DOMContentLoaded', async () => {
  async function initApp() {
    // ---------- Chờ dependencies ----------
    const waitFor = (condition, interval = 50) => new Promise(resolve => {
      const check = () => condition() ? resolve() : setTimeout(check, interval);
      check();
    });
    await waitFor(() => typeof XLSX !== 'undefined' && window.firebaseReady);
    const db = window.db;
    console.log('✅ Firebase & SheetJS ready');

    // ---------- Fallback to localStorage if Firebase fails ----------
    let useLocalStorage = false;
    const testFB = async () => {
      try {
        await get(ref(db, '/test'));
        return false;
      } catch (e) {
        console.warn('Firebase permission issue, fallback to localStorage:', e);
        useLocalStorage = true;
        return true;
      }
    };
    useLocalStorage = await testFB();

    // ---------- Config paths ----------
    const PATH = {
      EXCEL: 'excelData_v2',     // lưu dữ liệu gốc / invoices
      PHONG: 'phongBanList',
      TEN: 'tenNhanVienList',
      HISTORY: 'xuatHistory',
      MANUAL: 'stockManual'      // lưu chỉnh tay (ghi đè hoặc cập nhật tồn)
    };

    // ---------- LocalStorage helpers (for fallback) ----------
    const saveLocal = (key, data) => localStorage.setItem(key, JSON.stringify(data));
    const loadLocal = (key, fallback) => {
      try {
        return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
      } catch (e) {
        return fallback;
      }
    };

    // ---------- DOM ----------
    const excelInput = document.getElementById('excelInput');
    const clearBtn = document.getElementById('clearBtn');
    const codesDiv = document.getElementById('codes');
    const searchCodesInput = document.getElementById('searchCodes');
    const stockTbody = document.querySelector('#stockTable tbody');
    const stockFooter = document.getElementById('stockFooter');
    const totalQty = document.getElementById('totalQty');
    const totalAmount = document.getElementById('totalAmount');
    const popupDetail = document.getElementById('popup');
    const popupDetailHeader = document.getElementById('popupHeader');
    const popupDetailTable = document.querySelector('#popupTable tbody');
    const closePopupBtn = document.getElementById('closePopup');

    const xuatBtn = document.getElementById('xuatBtn');
    const xuatPopup = document.getElementById('xuatPopup');
    const closeXuatBtn = document.getElementById('closeXuat');
    const chonPhong = document.getElementById('chonPhong');
    const themPhongBtn = document.getElementById('themPhong');
    const tenNhanInput = document.getElementById('tenNhanVien');
    const suggestTen = document.getElementById('suggestTen');
    const themTenBtn = document.getElementById('themTen');
    const xuatTableBody = document.querySelector('#xuatTable tbody');
    const confirmXuatBtn = document.getElementById('confirmXuat');

    // ---------- DOM cho bộ lọc thời gian ----------
    const showStockFilterBtn = document.getElementById('showStockFilter');
    const stockFilter = document.getElementById('stockFilter');
    const applyStockFilterBtn = document.getElementById('applyStockFilter');
    const toggleStockModeBtn = document.getElementById('toggleStockMode');
    const stockFromDate = document.getElementById('stockFromDate');
    const stockToDate = document.getElementById('stockToDate');

    const viewPhieuBtn = document.getElementById('viewPhieu');
    const lichSuNhanBtn = document.getElementById('lichSuNhan');
    // ---------- ✅ THÊM DOM CHO NÚT THÊM SẢN PHẨM ----------
const addProductBtn = document.getElementById('addProductBtn');
const addProductPopup = document.getElementById('addProductPopup');
const closeAddProductBtn = document.getElementById('closeAddProduct');
const saveNewProductBtn = document.getElementById('saveNewProduct');
const newProductName = document.getElementById('newProductName');
const newProductUnit = document.getElementById('newProductUnit');
const newProductQty = document.getElementById('newProductQty');
const newProductPrice = document.getElementById('newProductPrice');
const addProductError = document.getElementById('addProductError');

    // ---------- THÊM CHO TOGGLE SIDEBAR ----------
    const toggleSidebarBtn = document.getElementById('toggleSidebar');
// ---------- LOCK SCREEN FUNCTIONALITY ----------
const lockScreen = document.getElementById('lockScreen');
const lockUsername = document.getElementById('lockUsername');
const lockPassword = document.getElementById('lockPassword');
const lockLoginBtn = document.getElementById('lockLoginBtn');
const lockError = document.getElementById('lockError');
const logoutBtn = document.getElementById('logoutBtn');

// Thông tin đăng nhập
const VALID_CREDENTIALS = {
  username: 'anh',
  password: '123123'
};

// Kiểm tra trạng thái đăng nhập
function checkAuth() {
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
  return isLoggedIn;
}

// Hiển thị/ẩn màn hình khóa
function toggleLockScreen(show) {
  if (show) {
    lockScreen.style.display = 'flex';
    logoutBtn.classList.add('hidden');
  } else {
    lockScreen.style.display = 'none';
    logoutBtn.classList.remove('hidden');
  }
}

// Xử lý đăng nhập
function handleLogin() {
  const username = lockUsername.value.trim();
  const password = lockPassword.value.trim();

  if (username === VALID_CREDENTIALS.username && password === VALID_CREDENTIALS.password) {
    // Đăng nhập thành công
    localStorage.setItem('isLoggedIn', 'true');
    lockError.textContent = '';
    toggleLockScreen(false);
  } else {
    // Đăng nhập thất bại
    lockError.textContent = 'Tên đăng nhập hoặc mật khẩu không đúng!';
    lockPassword.value = '';
    lockPassword.focus();
  }
}

// Xử lý đăng xuất
function handleLogout() {
  if (confirm('Bạn có chắc chắn muốn đăng xuất?')) {
    localStorage.setItem('isLoggedIn', 'false');
    toggleLockScreen(true);
    // Clear form
    lockUsername.value = '';
    lockPassword.value = '';
    lockError.textContent = '';
  }
}

// Event listeners
lockLoginBtn.addEventListener('click', handleLogin);

// Cho phép đăng nhập bằng phím Enter
lockPassword.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleLogin();
  }
});

logoutBtn.addEventListener('click', handleLogout);

// Kiểm tra auth khi load trang
if (!checkAuth()) {
  toggleLockScreen(true);
} else {
  toggleLockScreen(false);
}
    // ---------- State ----------
    let allData = {}; // mapping code -> invoice object
    let manualStock = {};
    let filteredCodes = [];
    let stockMode = 'current'; // 'current' cho tồn kho hiện tại, 'filtered' cho nhập theo thời gian
    let filteredInvoices = []; // Lưu hóa đơn đã lọc theo thời gian

    // ---------- Firebase helpers (with fallback) ----------
    async function saveToFirebase(path, data) {
      if (useLocalStorage) {
        saveLocal(path, data);
        return;
      }
      try {
        await set(ref(db, path), data);
        console.log(`✅ Saved to Firebase: ${path}`);
      } catch (e) {
        console.error('Lỗi lưu Firebase:', e);
        useLocalStorage = true;
        saveLocal(path, data);
        alert('Lưu vào localStorage (Firebase lỗi). Kiểm tra rules!');
      }
    }

    async function loadFromFirebase(path, fallback = {}) {
      if (useLocalStorage) return loadLocal(path, fallback);
      try {
        const snapshot = await get(ref(db, path));
        return snapshot.val() || fallback;
      } catch (e) {
        console.error('Lỗi load Firebase:', e);
        useLocalStorage = true;
        return loadLocal(path, fallback);
      }
    }

    function listenToFirebase(path, callback) {
      if (useLocalStorage) return; // No listen in fallback
      return onValue(ref(db, path), (snapshot) => {
        const val = snapshot.val();
        callback(val || {});
      });
    }

    // ---------- Utility helpers ----------
    function parseNumberFlexible(v) {
      if (v === null || v === undefined) return 0;
      if (typeof v === 'number') return v;
      let s = String(v).trim();
      if (s === '') return 0;
      // Thử thay thế dấu phẩy thành dấu chấm nếu có cả hai
      if (s.indexOf('.') > -1 && s.indexOf(',') > -1) {
        // Giả sử dấu chấm là phân cách hàng nghìn, dấu phẩy là thập phân -> xóa dấu chấm, thay dấu phẩy bằng chấm
        s = s.replace(/\./g, '').replace(/,/g, '.');
      } else if (s.indexOf(',') > -1) {
        // Nếu chỉ có dấu phẩy, thay bằng dấu chấm (coi là thập phân)
        s = s.replace(/,/g, '.');
      } else if (s.indexOf('.') > -1) {
        // FIX: Nếu chỉ có dấu chấm, coi là phân cách nghìn -> xóa hết dấu chấm
        s = s.replace(/\./g, '');
      }
      // Loại bỏ tất cả ký tự không phải số, dấu chấm (thập phân), dấu trừ
      s = s.replace(/[^\d\.\-]/g, '');
      // Nếu có nhiều dấu chấm, chỉ giữ lại dấu chấm cuối cùng (cho phần thập phân)
      const parts = s.split('.');
      if (parts.length > 2) {
        s = parts[0] + '.' + parts.slice(1).join('');
      }
      const n = Number(s);
      return isNaN(n) ? 0 : n;
    }

    // parse VN date-time strings robustly -> Date object
    function parseVnDateTime(str) {
      if (!str) return new Date(NaN);
      // Thử parse theo ISO
      const tryIso = new Date(str);
      if (!isNaN(tryIso)) return tryIso;
      // Tìm định dạng dd/mm/yyyy hoặc dd-mm-yyyy
      const m = String(str).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      const t = String(str).match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
      if (m) {
        const day = m[1].padStart(2, '0');
        const mon = m[2].padStart(2, '0');
        const year = m[3];
        const time = t ? (t[1].length === 5 ? t[1] + ':00' : t[1]) : '00:00:00';
        return new Date(`${year}-${mon}-${day}T${time}`);
      }
      // Thử parse lại với Date nếu không khớp
      const fallback = new Date(str);
      return isNaN(fallback) ? new Date(NaN) : fallback;
    }

    // escape html
    function esc(s) {
      if (s === null || s === undefined) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ---------- STOCK LEVEL FUNCTIONS ----------
    // Hàm xác định mức độ cảnh báo tồn kho
    function getStockLevelClass(quantity) {
      if (quantity <= 0) {
        return 'stock-out'; // Xám: đã hết hàng
      } else if (quantity <= 5) {
        return 'stock-critical'; // Đỏ: cực kỳ nguy cấp (≤5)
      } else if (quantity <= 15) {
        return 'stock-low'; // Cam: tồn kho thấp (6-15)
      } else {
        return 'stock-normal'; // Xanh: bình thường (>15)
      }
    }

    // Hàm lấy mô tả trạng thái tồn kho
    function getStockLevelDescription(quantity) {
      if (quantity <= 0) {
        return 'Đã hết hàng';
      } else if (quantity <= 5) {
        return 'Sắp hết hàng';
      } else if (quantity <= 15) {
        return 'Tồn kho thấp';
      } else {
        return 'Tồn kho tốt';
      }
    }

    // ---------- RENDER LEFT (MÃ PHIẾU) - Sắp xếp mới nhất đầu + Search ----------
    function renderLeft(filter = '') {
      filteredCodes = Object.keys(allData).filter(code => {
        const inv = allData[code];
        const searchStr = (code + (inv.date || '')).toLowerCase();
        return searchStr.includes(filter.toLowerCase());
      });

      // Sắp xếp theo date mới nhất (nếu có date, parse và sort descending)
      filteredCodes.sort((a, b) => {
        const dateA = allData[a].date ? parseVnDateTime(allData[a].date).getTime() : 0;
        const dateB = allData[b].date ? parseVnDateTime(allData[b].date).getTime() : 0;
        return dateB - dateA; // Mới nhất đầu
      });

      codesDiv.innerHTML = '';
      if (filteredCodes.length === 0) {
        codesDiv.innerHTML = '<div class="muted">Chưa có phiếu</div>';
        return;
      }
      filteredCodes.forEach(code => {
        const inv = allData[code];
        const div = document.createElement('div');
        div.className = 'code-item';
        // content: left info clickable, right delete button
        const info = document.createElement('div');
        info.style.flex = '1';
        info.innerHTML = `<div>Mã xuất: <strong>${esc(code)}</strong></div>${inv.date ? `<small>Ngày: ${esc(inv.date)}</small>` : ''}`;
        info.style.cursor = 'pointer';
        info.addEventListener('click', () => showInvoiceDetail(code));

        const del = document.createElement('button');
        del.textContent = '🗑️';
        del.title = 'Xóa phiếu';
        del.className = 'del-btn';
        del.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (confirm(`Xóa phiếu ${code}?`)) {
            delete allData[code];
            await saveToFirebase(PATH.EXCEL, allData);
            renderLeft(searchCodesInput.value);
            renderStock();
          }
        });

        div.appendChild(info);
        div.appendChild(del);
        codesDiv.appendChild(div);
      });
    }

    // Search listener
    searchCodesInput.addEventListener('input', (e) => renderLeft(e.target.value));

    // ---------- STOCK MAP: merge invoices -> map[name___unit] = {name, unit, qtyReq, qtyReal, price, amount} ----------
    function getCurrentStockMap() {
      const map = {};
      
      // 1. Tổng hợp từ allData (Excel imports)
      Object.values(allData).forEach(inv => {
        if (!inv || !inv.items) return;
        inv.items.forEach(it => {
          const name = (it.name||'').trim();
          const unit = (it.unit||'').trim();
          if (!name) return;
          const key = `${name}___${unit}`;
          
          if (!map[key]) {
            map[key] = {
              name,
              unit,
              qtyReq: Number(it.qtyReq) || 0,
              qtyReal: Number(it.qtyReal) || 0,
              price: Number(it.price) || 0,
              amount: Number(it.amount) || 0
            };
          } else {
            map[key].qtyReq += Number(it.qtyReq) || 0;
            map[key].qtyReal += Number(it.qtyReal) || 0;
            map[key].amount += Number(it.amount) || 0;
          }
        });
      });

     // 2. Áp dụng manual overrides (nếu có)
   // 2. Áp dụng manual overrides (nếu có)
if (manualStock && typeof manualStock === 'object') {
  Object.entries(manualStock).forEach(([key, v]) => {
    if (v && v.name && v.unit) {
      if (map[key]) {
        // Fix: Sử dụng ?? để ghi đè ngay cả khi = 0 (không fallback falsy như ||)
        map[key].qtyReal = Number(v.qtyReal) ?? map[key].qtyReal;
        map[key].price = Number(v.price) ?? map[key].price;
        map[key].amount = map[key].qtyReal * map[key].price;
      } else {
        // Nếu chưa tồn tại, tạo mới (hỗ trợ thêm sản phẩm thủ công)
        map[key] = {
          name: v.name,
          unit: v.unit,
          qtyReq: 0,
          qtyReal: Number(v.qtyReal) ?? 0,
          price: Number(v.price) ?? 0,
          amount: Number(v.amount) ?? 0
        };
      }
    }
  });
}
      
      return map;
    }

    // ---------- HÀM MỚI: Lấy map nhập theo thời gian (tổng hợp từ hóa đơn trong khoảng thời gian) ----------
    function getFilteredInputMap(fromDate, toDate) {
      const map = {};
      filteredInvoices = []; // Reset

      // Lọc hóa đơn theo ngày
      Object.entries(allData).forEach(([code, inv]) => {
        if (!inv || !inv.date) return;
        const invDate = parseVnDateTime(inv.date);
        if (isNaN(invDate)) return;

        // Kiểm tra khoảng thời gian
        if (fromDate && invDate < new Date(fromDate + 'T00:00:00')) return;
        if (toDate && invDate > new Date(toDate + 'T23:59:59')) return;

        filteredInvoices.push({ code, inv });
        // Tổng hợp items từ hóa đơn này
        if (!inv || !inv.items) return;
        inv.items.forEach(it => {
          const name = (it.name||'').trim();
          const unit = (it.unit||'').trim();
          if (!name) return;
          const key = `${name}___${unit}`;
          
          if (!map[key]) {
            map[key] = {
              name,
              unit,
              qtyReal: 0,
              price: Number(it.price) || 0,
              amount: 0
            };
          }
          map[key].qtyReal += Number(it.qtyReal) || 0;
          map[key].amount += Number(it.amount) || 0;
        });
      });

      return map;
    }

    // ---------- RENDER STOCK (ĐÃ SỬA: Hỗ trợ chế độ lọc thời gian + Dòng tổng) ----------
   function renderStock() {
  let map;
  let arr;
  const isFilteredMode = stockMode === 'filtered';
  const stockTotal = document.getElementById('stockTotal');

  if (isFilteredMode) {
    // Chế độ lọc: Tổng nhập theo thời gian
    const from = stockFromDate.value;
    const to = stockToDate.value;
    if (!from || !to) {
      alert('Vui lòng chọn khoảng thời gian từ và đến.');
      return;
    }
    map = getFilteredInputMap(from, to);
    arr = Object.values(map).filter(it => (it.qtyReal || 0) > 0);
    
    // Hiển thị tổng cộng dạng văn bản
    let totalQtyValue = 0;
    let totalAmountValue = 0;
    arr.forEach(it => {
      totalQtyValue += it.qtyReal;
      totalAmountValue += it.amount;
    });
    
    document.getElementById('totalQty').textContent = formatVnNumber(totalQtyValue);
    document.getElementById('totalAmount').textContent = formatVnNumber(totalAmountValue);
    stockTotal.style.display = 'block';
  } else {
    // Chế độ tồn kho hiện tại
    map = getCurrentStockMap();
    arr = Object.values(map).filter(it => (it.qtyReal || 0) > 0);
    stockTotal.style.display = 'none'; // Ẩn tổng cộng
  }

  stockTbody.innerHTML = "";

  if (arr.length === 0) {
    stockTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#777">Chưa có dữ liệu</td></tr>`;
    stockTotal.style.display = 'none';
    return;
  }

  // Helper function để format số VN (thêm .000 nếu cần)
  function formatVnNumber(num) {
    return num.toLocaleString('vi-VN');
  }

  arr.forEach((it, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.key = `${it.name}___${it.unit}`;
    const soLuong = isFilteredMode ? (it.qtyReal || 0) : (it.qtyReal || 0); // SL nhập hoặc tồn
    
    const donGia = it.price || 0;
    const thanhTien = soLuong * donGia;
    
    // Áp dụng class cảnh báo tồn kho (chỉ cho chế độ hiện tại)
    let stockClass = '';
    let stockDescription = '';
    if (!isFilteredMode) {
      stockClass = getStockLevelClass(soLuong);
      stockDescription = getStockLevelDescription(soLuong);
    }
    
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td contenteditable="true" class="col-name editable">${esc(it.name)}</td>
      <td contenteditable="true" class="col-unit editable">${esc(it.unit)}</td>
      <td contenteditable="true" class="col-qty num editable ${stockClass}" title="${stockDescription}">${formatVnNumber(soLuong)}</td>
      <td contenteditable="true" class="col-price num editable">${formatVnNumber(donGia)}</td>
      <td class="num">${formatVnNumber(thanhTien)}</td>
      <td><button class="delRow">🗑️</button></td>
    `;
    stockTbody.appendChild(tr);
  });

  // Thêm event cho editable: Format lại khi blur (thoát focus)
  stockTbody.querySelectorAll("[contenteditable]").forEach((cell) => {
    cell.addEventListener("blur", (e) => {
      const val = e.target.innerText.trim();
      if (cell.classList.contains('num') && val) {  // Chỉ format cột số
        const parsed = parseNumberFlexible(val);
        e.target.innerText = formatVnNumber(parsed);
        // Trigger input để lưu (nếu cần)
        cell.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    
    cell.addEventListener("input", () => {
      clearTimeout(window.saveTimer);
      window.saveTimer = setTimeout(() => {
        saveEditedStockFromTable();
        renderStockWarnings();
      }, 500);
    });
  });

  // Sửa xóa sản phẩm (chỉ cho chế độ hiện tại)
  if (!isFilteredMode) {
    stockTbody.querySelectorAll(".delRow").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (confirm("Bạn có chắc xóa sản phẩm này không?")) {
          const key = btn.closest("tr").dataset.key;
          const currentItem = getCurrentStockMap()[key];
          if (currentItem) {
            manualStock[key] = {
              ...currentItem,
              qtyReal: 0,
              amount: 0
            };
            await saveToFirebase(PATH.MANUAL, manualStock);
          }
          renderStock();
          renderStockWarnings();
        }
      });
    });
  }
  
  renderStockWarnings();
}

    // ---------- SAVE EDITED STOCK (ĐÃ SỬA: Merge thông minh) ----------
    async function saveEditedStockFromTable() {
      if (stockMode === 'filtered') return; // Không lưu chỉnh sửa ở chế độ lọc

      const rows = document.querySelectorAll("#stockTable tbody tr");
      const updates = {};
      
      rows.forEach((tr) => {
        const tds = tr.querySelectorAll("td");
        if (tds.length < 6) return;
        
        const name = tds[1].innerText.trim();
        if (!name) return;
        
        const unit = tds[2].innerText.trim();
        const qtyReal = parseNumberFlexible(tds[3].innerText);
        const price = parseNumberFlexible(tds[4].innerText);
        const amount = qtyReal * price;
        
        const key = `${name}___${unit}`;
        
        updates[key] = { 
          name, 
          unit, 
          qtyReal,
          price, 
          amount 
        };
      });
      
      // MERGE thông minh: chỉ cập nhật các trường được chỉnh sửa
      Object.keys(updates).forEach(key => {
        if (!manualStock[key]) {
          manualStock[key] = updates[key];
        } else {
          manualStock[key] = {
            ...manualStock[key],
            ...updates[key]
          };
        }
      });
      
      await saveToFirebase(PATH.MANUAL, manualStock);
      renderStock();
      renderStockWarnings();
    }

    // ---------- EVENT CHO BỘ LỌC THỜI GIAN ----------
    showStockFilterBtn.addEventListener('click', () => {
      stockFilter.style.display = 'block';
      showStockFilterBtn.style.display = 'none';
      stockMode = 'filtered';
      toggleStockModeBtn.textContent = 'Chuyển sang Tồn kho hiện tại';
      renderStock();
    });

    applyStockFilterBtn.addEventListener('click', () => {
      renderStock();
    });

    toggleStockModeBtn.addEventListener('click', () => {
      if (stockMode === 'filtered') {
        stockMode = 'current';
        stockFilter.style.display = 'none';
        showStockFilterBtn.style.display = 'block';
        toggleStockModeBtn.textContent = 'Chuyển sang Nhập theo thời gian';
        renderStock();
      }
    });



    // ---------- STOCK WARNING FUNCTIONS ----------
    function renderStockWarnings() {
      if (stockMode === 'filtered') {
        document.getElementById('stockWarnings').style.display = 'none'; // Ẩn cảnh báo ở chế độ lọc
        return;
      }

      const map = getCurrentStockMap();
      const warningItems = [];
      
      Object.values(map).forEach(it => {
        const soLuongTon = it.qtyReal || 0;
        
        // Chỉ cảnh báo cho sản phẩm còn tồn kho nhưng thấp
        if (soLuongTon > 0 && soLuongTon <= 15) {
          warningItems.push({
            name: it.name,
            unit: it.unit,
            qty: soLuongTon,
            level: soLuongTon <= 5 ? 'critical' : 'low'
          });
        }
      });
      
      const warningsContainer = document.getElementById('stockWarnings');
      const warningList = document.getElementById('warningList');
      
      if (warningItems.length === 0) {
        warningsContainer.style.display = 'none';
        return;
      }
      
      // Sắp xếp: critical trước, low sau
      warningItems.sort((a, b) => {
        if (a.level === 'critical' && b.level !== 'critical') return -1;
        if (a.level !== 'critical' && b.level === 'critical') return 1;
        return a.qty - b.qty; // Số lượng thấp hơn trước
      });
      
      let html = '';
      warningItems.forEach(item => {
        html += `
          <div class="warning-item ${item.level}">
            <div class="warning-info">
              <span class="warning-name">${esc(item.name)}</span>
              <span class="warning-unit">${esc(item.unit)}</span>
            </div>
            <div class="warning-qty">${item.qty}</div>
          </div>
        `;
      });
      
      warningList.innerHTML = html;
      warningsContainer.style.display = 'block';
    }

 // ---------- POPUP DETAIL FUNCTIONS ----------

// Sửa hàm showInvoiceDetail
function showInvoiceDetail(code) {
  const inv = allData[code];
  if (!inv) return;
  
  popupDetailHeader.innerHTML = `Mã xuất: <strong>${esc(code)}</strong>${inv.date ? ` &nbsp; | &nbsp; <b>Ngày:</b> ${esc(inv.date)}` : ''}`;
  popupDetailTable.innerHTML = '';
  (inv.items || []).forEach((it, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${esc(it.name)}</td>
      <td>${esc(it.unit)}</td>
      <td class="num">${it.qtyReq}</td>
      <td class="num">${it.qtyReal}</td>
      <td class="num">${it.price}</td>
      <td class="num">${(Number(it.qtyReal) * Number(it.price)).toLocaleString('vi-VN')}</td>
    `;
    popupDetailTable.appendChild(tr);
  });
  popupDetail.style.display = 'block';
  
  // Đảm bảo nút đóng hoạt động
  setupClosePopupBtn();
}

// Hàm thiết lập nút đóng popup chi tiết
function setupClosePopupBtn() {
  // Remove event listener cũ nếu có
  closePopupBtn.replaceWith(closePopupBtn.cloneNode(true));
  const newCloseBtn = document.getElementById('closePopup');
  
  // Thêm event listener mới
  newCloseBtn.addEventListener('click', () => {
    console.log('Close popup button clicked');
    popupDetail.style.display = 'none';
  });
}

    // ---------- Excel reading (SheetJS must be loaded) ----------
    excelInput.addEventListener('change', async (ev) => {
      if (typeof XLSX === 'undefined') {
        alert('Thư viện XLSX chưa được nạp.');
        return;
      }
      const files = Array.from(ev.target.files || []);
      for (const file of files) {
        try {
          const ab = await file.arrayBuffer();
          const wb = XLSX.read(ab, { type: 'array' });
          // use first sheet as default invoice
          const sheetName = wb.SheetNames[0];
          const sheet = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

          const headerText = rows.slice(0, 12).map(r => (r||[]).join(' ')).join('\n');
          let code = file.name.replace(/\.[^.]+$/, '');
          const codeMatch = headerText.match(/Mã\s*xuất[:\s]*([0-9A-Za-z\-]+)/i) || headerText.match(/Mã[:\s]*([0-9A-Za-z\-]+)/i);
          if (codeMatch) code = codeMatch[1].trim();

          let headerIdx = -1;
          for (let i = 0; i < Math.min(20, rows.length); i++) {
            const r = rows[i];
            if (!r) continue;
            const joined = r.join(' ').toLowerCase();
            if (joined.includes('stt') && (joined.includes('tên') || joined.includes('vật tư'))) {
              headerIdx = i;
              break;
            }
          }
          if (headerIdx === -1) headerIdx = 0;

          const headerRow = rows[headerIdx] || [];
          const colMap = {};
          headerRow.forEach((cell, j) => {
            if (!cell) return;
            const lower = cell.toLowerCase().trim();
            if (lower.includes('tên') || lower.includes('vật')) colMap.name = j;
            if (lower.includes('đvt') || lower.includes('đơn vị')) colMap.unit = j;
            if (lower.includes('sl yêu') || lower.includes('số lượng yêu')) colMap.qtyReq = j;
            if (lower.includes('sl thực') || lower.includes('thực phát')) colMap.qtyReal = j;
            if (lower.includes('đơn giá')) colMap.price = j;
            if (lower.includes('thành tiền') || lower.includes('t.tiền')) colMap.amount = j;
          });

          const items = [];
          for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 2) break;
            const name = row[colMap.name];
            if (!name || String(name).trim() === '') break;
            items.push({
              name: String(name || '').trim(),
              unit: String(row[colMap.unit] || '').trim(),
              qtyReq: parseNumberFlexible(row[colMap.qtyReq]),
              qtyReal: parseNumberFlexible(row[colMap.qtyReal]),
              price: parseNumberFlexible(row[colMap.price]),
              amount: parseNumberFlexible(row[colMap.amount])
            });
          }

          if (items.length > 0) {
            const dateMatch = headerText.match(/Ngày[:\s]*(\d{1,2}\/\d{1,2}\/\d{4}.*?)(?=\n|$)/i);
            const date = dateMatch ? dateMatch[1].trim() : new Date().toLocaleDateString('vi-VN');
            allData[code] = { items, date };
            await saveToFirebase(PATH.EXCEL, allData);
          }
        } catch (e) {
          console.error('Lỗi đọc file:', e, file.name);
          alert(`Lỗi đọc file ${file.name}: ${e.message}`);
        }
      }
      renderLeft(searchCodesInput.value);
      renderStock();
    });



    async function addPhong(val) {
      const list = await loadFromFirebase(PATH.PHONG, []);
      if (!Array.isArray(list)) return;
      if (!list.includes(val)) {
        list.push(val);
        await saveToFirebase(PATH.PHONG, list);
        loadPhongVaTen();
      }
    }

    themPhongBtn.addEventListener('click', async () => {
      const val = prompt('Nhập tên phòng/ban:');
      if (!val) return;
      await addPhong(val.trim());
    });



// ---------- XÁC NHẬN XUẤT HÀNG (ĐÃ SỬA: TRÁNH TRÙNG LẶP) ----------
let isProcessingXuat = false; // Biến cờ để tránh xử lý trùng lặp

confirmXuatBtn.addEventListener('click', async () => {
  // Kiểm tra tránh xử lý trùng lặp
  if (isProcessingXuat) {
    console.log('Đang xử lý xuất hàng, vui lòng chờ...');
    return;
  }
  
  isProcessingXuat = true;
  
  try {
    const phong = chonPhong.value;
    const nguoi = tenNhanVien.value.trim();
    
    if (!phong || !nguoi) {
      alert('Vui lòng chọn phòng và người nhận.');
      isProcessingXuat = false;
      return;
    }

    const items = [];
    const updates = {};
    
    // Thu thập danh sách xuất kho - CHỈ LẤY HÀNG CÓ SL > 0
    xuatTableBody.querySelectorAll('tr').forEach(tr => {
      if (tr.style.display !== 'none') { // Chỉ xét hàng đang hiển thị
        const inp = tr.querySelector('.slxuat');
        const qty = Number(inp.value) || 0;
        if (qty > 0) {
          const name = inp.dataset.name;
          const unit = inp.dataset.unit;
          items.push({ name, unit, qty });
          
          // Tính toán tồn kho mới
          const key = `${name}___${unit}`;
          const currentStock = getCurrentStockMap()[key];
          if (currentStock) {
            const newQty = Math.max(0, currentStock.qtyReal - qty);
            updates[key] = {
              ...currentStock,
              qtyReal: newQty,
              amount: newQty * currentStock.price
            };
          }
        }
      }
    });

    if (items.length === 0) {
      alert('Vui lòng nhập số lượng xuất ít nhất một mặt hàng.');
      isProcessingXuat = false;
      return;
    }

    console.log('Danh sách xuất hàng:', items);
    console.log('Cập nhật tồn kho:', updates);

    // Cập nhật tồn kho
    Object.keys(updates).forEach(key => {
      manualStock[key] = updates[key];
    });
    await saveToFirebase(PATH.MANUAL, manualStock);

    // Lưu lịch sử xuất hàng
    const now = new Date();
    const ngay = now.toLocaleDateString('vi-VN');
    const ngayISO = now.toISOString();
    const historyItem = { 
      phong, 
      nguoi, 
      danhSach: items, 
      ngay, 
      ngayISO,
      timestamp: now.getTime() // Thêm timestamp để tránh trùng lặp
    };

    let allHistory = await loadFromFirebase(PATH.HISTORY, []);
    if (!Array.isArray(allHistory)) allHistory = [];
    
    // Kiểm tra trùng lặp lịch sử (trong vòng 5 giây)
    const recentDuplicate = allHistory.find(h => 
      h.phong === phong && 
      h.nguoi === nguoi && 
      h.timestamp && 
      (now.getTime() - h.timestamp) < 5000
    );
    
    if (recentDuplicate) {
      console.warn('Phát hiện lịch sử xuất hàng trùng lặp gần đây:', recentDuplicate);
    }
    
    allHistory.push(historyItem);
    await saveToFirebase(PATH.HISTORY, allHistory);

    alert(`✅ Xuất hàng thành công!\nPhòng: ${phong}\nNgười nhận: ${nguoi}\nSố mặt hàng: ${items.length}`);
    
    // Reset form
    xuatPopup.style.display = 'none';
    tenNhanVien.value = '';
    xuatTableBody.querySelectorAll('.slxuat').forEach(inp => inp.value = '');
    
    // Render lại giao diện
    renderStock();
    renderStockWarnings();
    
  } catch (error) {
    console.error('Lỗi khi xuất hàng:', error);
    alert('❌ Có lỗi xảy ra khi xuất hàng: ' + error.message);
  } finally {
    // Luôn reset cờ khi kết thúc
    isProcessingXuat = false;
  }
});

// ---------- SỬA LẠI PHẦN MỞ POPUP XUẤT HÀNG ----------
xuatBtn.addEventListener('click', async () => {
  console.log('Nút xuất hàng được click');
  
  // Reset trạng thái trước khi mở popup
  isProcessingXuat = false;
  
  await loadPhongVaTen();
  
  // populate table - CHỈ lấy hàng còn tồn kho
  const map = getCurrentStockMap();
  xuatTableBody.innerHTML = '';
  
  // Lọc chỉ những hàng còn tồn kho (qtyReal > 0)
  const arr = Object.values(map).filter(it => (it.qtyReal || 0) > 0);
  
  if (arr.length === 0) {
    alert('Không có hàng tồn kho để xuất.');
    return;
  }
  
  arr.forEach((it, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${esc(it.name)}</td>
      <td>${esc(it.unit)}</td>
      <td class="num">${it.qtyReal}</td>
      <td><input type="number" class="slxuat" min="0" max="${it.qtyReal}" data-name="${esc(it.name)}" data-unit="${esc(it.unit)}" style="width:80px" value="0"></td>
    `;
    xuatTableBody.appendChild(tr);
  });
  
  xuatPopup.style.display = 'block';
  console.log('Popup xuất hàng đã hiển thị');
});

// ---------- THÊM SỰ KIỆN ĐÓNG POPUP ĐỂ RESET ----------
closeXuatBtn.addEventListener('click', () => {
  xuatPopup.style.display = 'none';
  isProcessingXuat = false; // Reset cờ khi đóng popup
});

// ESC key close - thêm reset cờ
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (popupDetail.style.display === 'block') popupDetail.style.display = 'none';
    if (xuatPopup.style.display === 'block') {
      xuatPopup.style.display = 'none';
      isProcessingXuat = false; // Reset cờ khi đóng bằng ESC
    }
  }
});

// ---------- CẢI THIỆN HÀM LOAD PHÒNG VÀ TÊN ----------
async function loadPhongVaTen() {
  const phong = await loadFromFirebase(PATH.PHONG, []);
  chonPhong.innerHTML = Array.isArray(phong) ? phong.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('') : '';
  
  const tenList = await loadFromFirebase(PATH.TEN, []);
  
  // Cập nhật select box người nhận
  tenNhanVien.innerHTML = '<option value="">-- Chọn người nhận --</option>' + 
    (Array.isArray(tenList) ? tenList.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('') : '');
}


// ---------- HÀM THÊM TÊN (CẢI THIỆN) ----------
async function addTen(val) {
  if (!val) return;
  
  const list = await loadFromFirebase(PATH.TEN, []);
  if (!Array.isArray(list)) return;
  
  // Chuẩn hóa tên (viết hoa chữ cái đầu, xóa khoảng trắng thừa)
  const standardizedVal = val.trim().replace(/\s+/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  // Kiểm tra xem đã tồn tại chưa (không phân biệt hoa thường)
  const exists = list.some(item => 
    item.toLowerCase().trim() === standardizedVal.toLowerCase().trim()
  );
  
  if (!exists) {
    list.push(standardizedVal);
    // Sắp xếp theo thứ tự alphabet
    list.sort((a, b) => a.localeCompare(b, 'vi-VN'));
    await saveToFirebase(PATH.TEN, list);
    
    // Reload danh sách và chọn người vừa thêm
    await loadPhongVaTen();
    tenNhanVien.value = standardizedVal;
  }
}

// ---------- SỰ KIỆN THÊM TÊN THỦ CÔNG ----------
themTenBtn.addEventListener('click', async () => {
  const val = prompt('Nhập tên người nhận mới:');
  if (!val) return;
  
  await addTen(val);
});

    lichSuNhanBtn.addEventListener('click', async () => {
      let allHistory;
      if (useLocalStorage) {
        allHistory = loadLocal(PATH.HISTORY, []);
      } else {
        const historyData = await loadFromFirebase(PATH.HISTORY, []);
        allHistory = Array.isArray(historyData) ? historyData : Object.values(historyData || {});
      }
      if (!Array.isArray(allHistory) || !allHistory.length) return alert('Chưa có lịch sử nhận hàng.');

      // Group by date (ngayISO), sort descending (mới nhất đầu)
      const groupedByDate = {};
      allHistory.forEach(h => {
        const dateKey = h.ngayISO ? h.ngayISO.split('T')[0] : new Date().toISOString().split('T')[0];
        if (!groupedByDate[dateKey]) groupedByDate[dateKey] = [];
        groupedByDate[dateKey].push(h);
      });

      const dates = Object.keys(groupedByDate).sort((a, b) => new Date(b) - new Date(a)); // Mới nhất đầu

      // build popup
      const popup = document.createElement('div');
      popup.className = 'popup';
      popup.style.display = 'block';
      popup.innerHTML = `
      <header>
        📅 Lịch sử nhận hàng
        <button id="closeLichSuNhan" class="popup-close-btn" title="Đóng">✖</button>
      </header>
      <div class="body" style="padding:10px;max-height:80vh;overflow:auto;">
        <div id="lichSuContainer"></div>
      </div>
    `;
      document.body.appendChild(popup);
      const container = document.getElementById('lichSuContainer');
      document.getElementById('closeLichSuNhan').addEventListener('click', () => popup.remove());

      // Render dates accordion
      let html = '';
      dates.forEach(dateKey => {
        const dateStr = new Date(dateKey).toLocaleDateString('vi-VN');
        const historyForDate = groupedByDate[dateKey];
        
        // Group by phong for this date
        const groupedByPhong = {};
        historyForDate.forEach(h => {
          if (!groupedByPhong[h.phong]) groupedByPhong[h.phong] = [];
          groupedByPhong[h.phong].push(h);
        });

        html += `
          <div class="date-item">
            <div class="date-header" onclick="this.nextElementSibling.classList.toggle('active'); this.querySelector('.arrow').innerText = this.nextElementSibling.classList.contains('active') ? '▼' : '▶';">
              📅 ${dateStr} <span class="arrow">▶</span>
            </div>
            <div class="date-content">
        `;

        // Render phong accordion for this date
        Object.keys(groupedByPhong).sort().forEach(phong => {
          const arr = groupedByPhong[phong];
          
          // Group by nhan vien for this phong
          const groupedByNhanVien = {};
          arr.forEach(h => {
            if (!groupedByNhanVien[h.nguoi]) groupedByNhanVien[h.nguoi] = [];
            groupedByNhanVien[h.nguoi].push(h);
          });

          html += `
            <div class="phong-item">
              <div class="phong-header" onclick="this.nextElementSibling.classList.toggle('active'); this.querySelector('.arrow').innerText = this.nextElementSibling.classList.contains('active') ? '▼' : '▶';">
                🏢 ${esc(phong)} <span class="arrow">▶</span>
              </div>
              <div class="phong-content">
          `;

          // Render nhan vien table
          Object.keys(groupedByNhanVien).sort().forEach(nhanVien => {
            const nhanVienHistory = groupedByNhanVien[nhanVien];
            
            html += `
              <div style="margin: 8px 0;">
                <div style="font-weight: 600; padding: 6px 12px; background: #f0f0f0;">👤 ${esc(nhanVien)}</div>
                <table class="nhanvien-table">
                  <thead>
                    <tr>
                      <th style="width:50%">Tên vật tư</th>
                      <th style="width:20%">Thời gian nhận</th>
                      <th style="width:15%">ĐVT</th>
                      <th style="width:15%">Số lượng</th>
                    </tr>
                  </thead>
                  <tbody>
            `;

            // Collect all items for this nhan vien
            const allItems = [];
            nhanVienHistory.forEach(h => {
              (h.danhSach || []).forEach(it => {
                allItems.push({
                  name: it.name,
                  unit: it.unit,
                  qty: it.qty,
                  time: h.ngay // Sử dụng thời gian từ lịch sử
                });
              });
            });

            allItems.forEach((it, idx) => {
              html += `
                <tr>
                  <td>${esc(it.name)}</td>
                  <td>${esc(it.time)}</td>
                  <td>${esc(it.unit)}</td>
                  <td class="num">${it.qty}</td>
                </tr>
              `;
            });

            html += `
                  </tbody>
                </table>
              </div>
            `;
          });

          html += `
              </div>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      container.innerHTML = html || '<div style="color:#777; text-align:center; padding:20px;">Chưa có lịch sử nhận hàng.</div>';
    });


    function renderNhanVienAccordion(arr) {
      // Group by nguoi
      const groupedByNguoi = {};
      arr.forEach(h => {
        if (!groupedByNguoi[h.nguoi]) groupedByNguoi[h.nguoi] = { danhSach: [] };
        groupedByNguoi[h.nguoi].danhSach.push(...(h.danhSach || []));
      });

      let html = '';
      Object.keys(groupedByNguoi).sort().forEach(nguoi => {
        const items = groupedByNguoi[nguoi].danhSach;
        const m = {};
        items.forEach(it => {
          const key = `${it.name}___${it.unit}`;
          if (!m[key]) m[key] = { name: it.name, unit: it.unit, tong: 0 };
          m[key].tong += Number(it.qty) || 0;
        });

        html += `
          <div class="accordion-subheader" onclick="this.nextElementSibling.classList.toggle('active'); this.querySelector('.arrow').innerText = this.nextElementSibling.classList.contains('active') ? '▼' : '▶';">
            ${esc(nguoi)} <span class="arrow">▶</span>
          </div>
          <div class="sub-content">
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr><th>Hàng</th><th>SL</th></tr></thead><tbody>
        `;
        Object.values(m).forEach(it => {
          html += `<tr><td>${esc(it.name)} (${esc(it.unit)})</td><td class="num">${it.tong}</td></tr>`;
        });
        html += '</tbody></table></div>';
      });
      return html;
    }

    viewPhieuBtn.addEventListener('click', async () => {
      let allHistory;
      if (useLocalStorage) {
        allHistory = loadLocal(PATH.HISTORY, []);
      } else {
        const historyData = await loadFromFirebase(PATH.HISTORY, []);
        allHistory = Array.isArray(historyData) ? historyData : Object.values(historyData || {});
      }
      if (!Array.isArray(allHistory) || !allHistory.length) return alert('Chưa có lịch sử xuất hàng.');

      // build popup
      const popup = document.createElement('div');
      popup.className = 'popup';
      popup.style.display = 'block';
      popup.innerHTML = `
      <header>
        📋 Danh sách nhận
        <button id="closeHis" class="popup-close-btn" title="Đóng">✖</button>
      </header>
      <div class="body">
          <div class="filter-bar">
            <div class="filter-group">
              <label>📅 Từ:</label>
              <input type="date" id="fromDate">
            </div>
            <div class="filter-group">
              <label>Đến:</label>
              <input type="date" id="toDate">
            </div>
            <div class="filter-group">
              <label>🏢 Phòng:</label>
              <select id="filterPhong">
                <option value="">-- Tất cả --</option>
                ${[...new Set(allHistory.map(h => h.phong))].sort().map(p => 
                  `<option value="${esc(p)}">${esc(p)}</option>`
                ).join('')}
              </select>
            </div>
            <div class="filter-group">
              <label>👤 NV:</label>
              <select id="filterNguoi">
                <option value="">-- Tất cả --</option>
                ${[...new Set(allHistory.map(h => h.nguoi))].sort().map(n => 
                  `<option value="${esc(n)}">${esc(n)}</option>`
                ).join('')}
              </select>
            </div>
            <button id="btnLoc" class="main-btn">🔍 Lọc</button>
          </div>
          <div id="hisContainer"></div>
        </div>
      `;
      document.body.appendChild(popup);
      document.getElementById('closeHis').addEventListener('click', () => popup.remove());

      function applyFilterAndRender() {
        const fromVal = document.getElementById('fromDate').value;
        const toVal = document.getElementById('toDate').value;
        const from = fromVal ? new Date(fromVal + 'T00:00:00') : null;
        const to = toVal ? new Date(toVal + 'T23:59:59') : null;
        const phongFilter = document.getElementById('filterPhong').value;
        const nguoiFilter = document.getElementById('filterNguoi').value;

        const filtered = allHistory.filter(h => {
          const d = h.ngayISO ? new Date(h.ngayISO) : parseVnDateTime(h.ngay);
          if (isNaN(d)) return false;
          if (from && d < from) return false;
          if (to && d > to) return false;
          if (phongFilter && h.phong !== phongFilter) return false;
          if (nguoiFilter && h.nguoi !== nguoiFilter) return false;
          return true;
        });

        // Group by phong
        const grouped = {};
        filtered.forEach(h => {
          if (!grouped[h.phong]) grouped[h.phong] = [];
          grouped[h.phong].push(h);
        });

        let html = '';
        Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).forEach(([phong, arr]) => {
          // Tính tổng số lượng theo tên nhân viên cho mỗi vật tư
          const itemsMap = {};
          arr.forEach(h => {
            (h.danhSach || []).forEach(it => {
              const key = `${it.name}___${it.unit}`;
              if (!itemsMap[key]) {
                itemsMap[key] = {
                  name: it.name,
                  unit: it.unit,
                  nhanVienList: {}
                };
              }
              // Cộng dồn theo nhân viên
              if (!itemsMap[key].nhanVienList[h.nguoi]) {
                itemsMap[key].nhanVienList[h.nguoi] = 0;
              }
              itemsMap[key].nhanVienList[h.nguoi] += Number(it.qty) || 0;
            });
          });

          html += `
            <div class="accordion-item">
              <div class="accordion-header" onclick="this.nextElementSibling.classList.toggle('active'); this.querySelector('.arrow').innerText = this.nextElementSibling.classList.contains('active') ? '▼' : '▶';">
                🏢 ${esc(phong)} <span class="arrow">▶</span>
              </div>
              <div class="accordion-content">
                <table>
                  <thead>
                    <tr>
                      <th style="width:50%">Tên vật tư</th>
                      <th style="width:30%">Chi tiết nhận</th>
                      <th style="width:20%">Tổng SL</th>
                    </tr>
                  </thead>
                  <tbody>
          `;

          Object.values(itemsMap).forEach(it => {
            // Format chi tiết nhận: "quyết 5 - hà 6 - ngân 8"
            const chiTiet = Object.entries(it.nhanVienList)
              .map(([nv, sl]) => `${esc(nv)} ${sl}`)
              .join(' - ');
            
            const tongSL = Object.values(it.nhanVienList).reduce((sum, sl) => sum + sl, 0);

            html += `
              <tr>
                <td>${esc(it.name)} (${esc(it.unit)})</td>
                <td>${chiTiet}</td>
                <td class="num">${tongSL}</td>
              </tr>
            `;
          });

          html += `
                  </tbody>
                </table>
              </div>
            </div>
          `;
        });

        document.getElementById('hisContainer').innerHTML = html || '<div style="color:#777; text-align:center; padding:20px;">Không có dữ liệu phù hợp.</div>';
      }

      document.getElementById('btnLoc').addEventListener('click', applyFilterAndRender);
      applyFilterAndRender(); // initial render
    });

// ---------- THÊM EVENT LISTENER CHO TOGGLE SIDEBAR ----------
if (toggleSidebarBtn) {
  toggleSidebarBtn.addEventListener('click', () => {
    const sidebar = document.getElementById('left');
    const mainContent = document.getElementById('center');
    
    console.log('Toggle sidebar clicked'); // Debug
    
    sidebar.classList.toggle('sidebar-hidden');
    
    // Đổi text nút cho user-friendly
    if (sidebar.classList.contains('sidebar-hidden')) {
      toggleSidebarBtn.textContent = '☰ Hiện danh sách';
      toggleSidebarBtn.title = 'Hiện danh sách phiếu';
      // Trên mobile, mở rộng center khi sidebar ẩn
      if (window.innerWidth <= 768) {
        mainContent.style.height = '100%';
      }
    } else {
      toggleSidebarBtn.textContent = '☰ Ẩn danh sách';
      toggleSidebarBtn.title = 'Ẩn danh sách phiếu';
      // Trên mobile, reset height khi sidebar hiện
      if (window.innerWidth <= 768) {
        mainContent.style.height = '';
      }
    }
  });
  
  // Initial state: Mặc định ẨN sidebar khi truy cập
  document.getElementById('left').classList.add('sidebar-hidden');
  toggleSidebarBtn.textContent = '☰ Hiện danh sách';
  toggleSidebarBtn.title = 'Hiện danh sách phiếu';
  
  // Trên mobile, mở rộng center khi sidebar ẩn
  if (window.innerWidth <= 768) {
    document.getElementById('center').style.height = '100%';
  }
}

// ---------- EVENT LISTENER CHO CLEAR ALL DATA ----------
clearBtn.addEventListener('click', async () => {
  if (!confirm('⚠️ Xóa toàn bộ dữ liệu? Không thể khôi phục! Bao gồm phiếu nhập, tồn kho, lịch sử xuất, phòng ban, và người nhận.')) {
    return; // Hủy nếu không confirm
  }

  try {
    // Reset state
    allData = {};
    manualStock = {};
    
    // Xóa các path chính (set empty)
    await saveToFirebase(PATH.EXCEL, {});     // Xóa phiếu Excel
    await saveToFirebase(PATH.MANUAL, {});    // Xóa chỉnh sửa tay
    await saveToFirebase(PATH.HISTORY, []);   // Xóa lịch sử xuất (array empty)
    await saveToFirebase(PATH.PHONG, []);     // Xóa danh sách phòng ban (nếu muốn)
    await saveToFirebase(PATH.TEN, []);       // Xóa danh sách người nhận (nếu muốn)
    
    console.log('✅ Đã xóa toàn bộ dữ liệu thành công!');
    alert('Đã xóa toàn bộ dữ liệu! Trang sẽ reload để cập nhật.');
    
    // Render lại UI
    renderLeft(searchCodesInput.value);
    renderStock();
    
    // Optional: Reload trang để sync Firebase (nếu multi-device)
    // location.reload();  // Uncomment nếu cần
  } catch (e) {
    console.error('Lỗi xóa dữ liệu:', e);
    alert('Lỗi khi xóa: ' + e.message + '. Kiểm tra kết nối Firebase.');
  }
});
// ---------- ✅ THÊM EVENT LISTENER CHO NÚT THÊM SẢN PHẨM ----------
if (addProductBtn) {
  addProductBtn.addEventListener('click', () => {
    addProductPopup.style.display = 'block';
    // Reset form
    newProductName.value = '';
    newProductUnit.value = '';
    newProductQty.value = '';
    newProductPrice.value = '';
    addProductError.textContent = '';
  });

  closeAddProductBtn.addEventListener('click', () => {
    addProductPopup.style.display = 'none';
  });

  // Đóng popup khi click ngoài
  addProductPopup.addEventListener('click', (e) => {
    if (e.target === addProductPopup) {
      addProductPopup.style.display = 'none';
    }
  });

  saveNewProductBtn.addEventListener('click', async () => {
    const name = newProductName.value.trim();
    const unit = newProductUnit.value.trim();
    const qty = parseNumberFlexible(newProductQty.value);
    const price = parseNumberFlexible(newProductPrice.value);

    // Validation
    if (!name) {
      addProductError.textContent = 'Tên sản phẩm không được để trống!';
      newProductName.focus();
      return;
    }
    if (!unit) {
      addProductError.textContent = 'Đơn vị không được để trống!';
      newProductUnit.focus();
      return;
    }
    if (qty <= 0) {
      addProductError.textContent = 'Số lượng phải lớn hơn 0!';
      newProductQty.focus();
      return;
    }
    if (price <= 0) {
      addProductError.textContent = 'Đơn giá phải lớn hơn 0!';
      newProductPrice.focus();
      return;
    }

    // Tạo key và object mới
    const key = `${name}___${unit}`;
    const newProduct = {
      name,
      unit,
      qtyReal: qty,
      price,
      amount: qty * price
    };

    // Thêm vào manualStock
    manualStock[key] = newProduct;

    // Lưu vào Firebase
    await saveToFirebase(PATH.MANUAL, manualStock);

    // Đóng popup và thông báo
    addProductPopup.style.display = 'none';
    alert(`✅ Đã thêm sản phẩm "${name} (${unit})" với tồn kho ${qty} (giá ${price} VNĐ)!`);

    // Render lại stock
    renderStock();
  });
}
    // ---------- initial render ----------
    allData = await loadFromFirebase(PATH.EXCEL, {});
    manualStock = await loadFromFirebase(PATH.MANUAL, {});
    await loadPhongVaTen();
    renderLeft();
    renderStock();

    // Listen to changes (if not fallback)
    if (!useLocalStorage) {
      listenToFirebase(PATH.EXCEL, (data) => { allData = data; renderLeft(searchCodesInput.value); renderStock(); });
      listenToFirebase(PATH.MANUAL, (data) => { manualStock = data; renderStock(); });
    }

    // expose debug function to console if needed
    window.debugStorage = async function() {
      console.log({
        allData,
        manual: manualStock,
        phong: await loadFromFirebase(PATH.PHONG, []),
        ten: await loadFromFirebase(PATH.TEN, []),
        history: await loadFromFirebase(PATH.HISTORY, []),
        usingLocal: useLocalStorage
      });
    };
  }
// ---------- HÀM MỚI: Toggle cảnh báo tồn kho ----------
    window.toggleWarnings = function() {
      const warningList = document.getElementById('warningList');
      const arrow = document.getElementById('toggleArrow');
      if (warningList.style.display === 'none') {
        warningList.style.display = 'block';
        arrow.textContent = '▼';
      } else {
        warningList.style.display = 'none';
        arrow.textContent = '▶';
      }
    };
  // ---------- SEARCH FUNCTIONALITY ----------

// Tìm kiếm trong bảng tồn kho
const searchStockInput = document.getElementById('searchStock');
if (searchStockInput) {
  searchStockInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();
    filterStockTable(searchTerm);
  });
}

// Tìm kiếm trong popup xuất hàng
const searchXuatInput = document.getElementById('searchXuat');
if (searchXuatInput) {
  searchXuatInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();
    filterXuatTable(searchTerm);
  });
}

// Hàm lọc bảng tồn kho
function filterStockTable(searchTerm) {
  const rows = document.querySelectorAll('#stockTable tbody tr');
  let visibleCount = 0;
  
  rows.forEach((row, index) => {
    const nameCell = row.querySelector('.col-name');
    const unitCell = row.querySelector('.col-unit');
    
    if (nameCell && unitCell) {
      const name = nameCell.textContent.toLowerCase();
      const unit = unitCell.textContent.toLowerCase();
      
      const matches = searchTerm === '' || 
                     name.includes(searchTerm) || 
                     unit.includes(searchTerm);
      
      row.style.display = matches ? '' : 'none';
      
      // Cập nhật STT chỉ cho các hàng hiển thị
      if (matches) {
        visibleCount++;
        const sttCell = row.querySelector('td:first-child');
        if (sttCell) {
          sttCell.textContent = visibleCount;
        }
      }
    }
  });
  
  // Hiển thị thông báo nếu không có kết quả
  const tbody = document.querySelector('#stockTable tbody');
  const noResultsRow = tbody.querySelector('.no-results');
  
  if (visibleCount === 0 && searchTerm !== '') {
    if (!noResultsRow) {
      const row = document.createElement('tr');
      row.className = 'no-results';
      row.innerHTML = `<td colspan="7" style="text-align:center;color:#777;padding:20px;">Không tìm thấy sản phẩm nào phù hợp với "<strong>${esc(searchTerm)}</strong>"</td>`;
      tbody.appendChild(row);
    }
  } else if (noResultsRow) {
    noResultsRow.remove();
  }
}

// Hàm lọc bảng xuất hàng
function filterXuatTable(searchTerm) {
  const rows = document.querySelectorAll('#xuatTable tbody tr');
  let visibleCount = 0;
  
  rows.forEach((row, index) => {
    const nameCell = row.querySelector('td:nth-child(2)'); // Cột tên sản phẩm
    const unitCell = row.querySelector('td:nth-child(3)'); // Cột đơn vị
    
    if (nameCell && unitCell) {
      const name = nameCell.textContent.toLowerCase();
      const unit = unitCell.textContent.toLowerCase();
      
      const matches = searchTerm === '' || 
                     name.includes(searchTerm) || 
                     unit.includes(searchTerm);
      
      row.style.display = matches ? '' : 'none';
      
      // Cập nhật STT chỉ cho các hàng hiển thị
      if (matches) {
        visibleCount++;
        const sttCell = row.querySelector('td:first-child');
        if (sttCell) {
          sttCell.textContent = visibleCount;
        }
      }
    }
  });
  
  // Hiển thị thông báo nếu không có kết quả
  const tbody = document.querySelector('#xuatTable tbody');
  const noResultsRow = tbody.querySelector('.no-results');
  
  if (visibleCount === 0 && searchTerm !== '') {
    if (!noResultsRow) {
      const row = document.createElement('tr');
      row.className = 'no-results';
      row.innerHTML = `<td colspan="5" style="text-align:center;color:#777;padding:20px;">Không tìm thấy sản phẩm nào phù hợp với "<strong>${esc(searchTerm)}</strong>"</td>`;
      tbody.appendChild(row);
    }
  } else if (noResultsRow) {
    noResultsRow.remove();
  }
}

// Thêm placeholder gợi ý cho ô tìm kiếm
if (searchStockInput) {
  searchStockInput.placeholder = 'Tìm theo tên sản phẩm hoặc đơn vị...';
}

if (searchXuatInput) {
  searchXuatInput.placeholder = 'Tìm theo tên sản phẩm hoặc đơn vị...';
}  
  // Khởi động ngay
  initApp();
});