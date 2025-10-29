// script.js
// Quản lý tồn kho từ Excel — bản hoàn chỉnh với Firebase Realtime Database + Error Handling + Fix History + Login + Logout/Reset + Thêm/Sửa Tồn Kho

import { getDatabase, ref, set, get, onValue, push } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

document.addEventListener('DOMContentLoaded', async () => {
  // ---------- LOGIN HANDLER ----------
  const loginOverlay = document.getElementById('loginOverlay');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');
  const mainHeader = document.getElementById('mainHeader');
  const mainContent = document.getElementById('mainContent');

  const VALID_USER = 'dieuanh';
  const VALID_PASS = 'Dieuanh1989';

  // Không sử dụng localStorage cho trạng thái login để đảm bảo mỗi lần mở lại phải login
  // Luôn hiển thị màn hình khóa ban đầu

  loginBtn.addEventListener('click', () => {
    const user = usernameInput.value.trim();
    const pass = passwordInput.value.trim();
    if (user === VALID_USER && pass === VALID_PASS) {
      showMainContent();
    } else {
      loginError.style.display = 'block';
      setTimeout(() => loginError.style.display = 'none', 3000);
    }
  });

  // Enter key support
  [usernameInput, passwordInput].forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') loginBtn.click();
    });
  });

  function showMainContent() {
    loginOverlay.style.display = 'none';
    mainHeader.style.display = 'block';
    mainContent.style.display = 'block';
    // Clear inputs
    usernameInput.value = '';
    passwordInput.value = '';
    initApp(); // Khởi động app chính
  }

  function showLogin() {
    loginOverlay.style.display = 'flex';
    mainHeader.style.display = 'none';
    mainContent.style.display = 'none';
  }

  // ---------- LOGOUT HANDLER ----------
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn.addEventListener('click', () => {
    // Xóa bất kỳ dữ liệu tạm nếu cần, nhưng chủ yếu reset UI
    showLogin();
  });

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
    const addStockBtn = document.getElementById('addStockBtn'); // Thêm nút thêm sản phẩm
    const codesDiv = document.getElementById('codes');
    const stockTbody = document.querySelector('#stockTable tbody');
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

    const viewPhieuBtn = document.getElementById('viewPhieu');

    // ---------- State ----------
    let allData = {}; // mapping code -> invoice object
    let manualStock = {};

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
    // parse number strings like "2.436.000" or "1,234.56"
    function parseNumberFlexible(v) {
      if (v === null || v === undefined) return 0;
      if (typeof v === 'number') return v;
      let s = String(v).trim();
      if (s === '') return 0;
      // if contains both dot and comma, try heuristic: dot thousands, comma decimal OR vice versa
      if (s.indexOf('.') > -1 && s.indexOf(',') > -1) {
        // assume dot thousands, comma decimal => remove dots, replace comma with dot
        const alt1 = Number(s.replace(/\./g, '').replace(/,/g, '.'));
        if (!isNaN(alt1)) return alt1;
      }
      // else remove non-digit except dot and minus
      s = s.replace(/[^\d\.\-]/g, '');
      const n = Number(s);
      return isNaN(n) ? 0 : n;
    }

    // parse VN date-time strings robustly -> Date object
    function parseVnDateTime(str) {
      if (!str) return new Date(NaN);
      // if already ISO-like
      const tryIso = new Date(str);
      if (!isNaN(tryIso)) return tryIso;
      // find dd/mm/yyyy
      const m = String(str).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      const t = String(str).match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
      if (m) {
        const day = m[1].padStart(2, '0');
        const mon = m[2].padStart(2, '0');
        const year = m[3];
        const time = t ? (t[1].length === 5 ? t[1] + ':00' : t[1]) : '00:00:00';
        return new Date(`${year}-${mon}-${day}T${time}`);
      }
      return new Date(NaN);
    }

    // escape html
    function esc(s) {
      if (s === null || s === undefined) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ---------- STOCK MAP: merge invoices -> map[name___unit] = {name, unit, qtyReq, qtyReal, price, amount}
    function getCurrentStockMap() {
      const map = {};
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

      // apply manual overrides if present (manual is an object by key)
      if (manualStock && typeof manualStock === 'object' && Object.keys(manualStock).length) {
        // manual entries use name___unit as keys
        Object.entries(manualStock).forEach(([k, v]) => {
          // v should have name, unit, qtyReq, qtyReal, price, amount
          map[k] = {
            name: v.name,
            unit: v.unit,
            qtyReq: Number(v.qtyReq) || 0,
            qtyReal: Number(v.qtyReal) || 0,
            price: Number(v.price) || 0,
            amount: Number(v.amount) || 0
          };
        });
      }
      return map;
    }

    // ---------- HÀM THÊM SẢN PHẨM MỚI ----------
    function addNewStockItem() {
      // Tạo popup thêm sản phẩm
      const popup = document.createElement('div');
      popup.className = 'popup';
      popup.style.display = 'block';
      popup.innerHTML = `
        <header>➕ Thêm sản phẩm mới vào tồn kho <span id="closeAddStock">✖</span></header>
        <div class="body" style="padding: 12px;">
          <div class="form-row">
            <label>Tên vật tư:</label>
            <input id="newName" type="text" style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div class="form-row">
            <label>ĐVT:</label>
            <input id="newUnit" type="text" placeholder="Ví dụ: cái, kg..." style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div class="form-row">
            <label>SL tồn:</label>
            <input id="newQty" type="number" min="0" value="0" style="width: 100px; padding: 6px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div class="form-row">
            <label>Đơn giá:</label>
            <input id="newPrice" type="number" min="0" step="0.01" value="0" style="width: 120px; padding: 6px; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <button id="confirmAddStock" class="main-btn">✅ Thêm</button>
        </div>
      `;
      document.body.appendChild(popup);

      // Xử lý đóng popup
      document.getElementById('closeAddStock').addEventListener('click', () => popup.remove());
      document.addEventListener('click', (ev) => {
        if (ev.target === popup) popup.remove();
      });

      // Xử lý xác nhận thêm
      document.getElementById('confirmAddStock').addEventListener('click', async () => {
        const name = document.getElementById('newName').value.trim();
        const unit = document.getElementById('newUnit').value.trim() || 'cái';
        const qtyReal = parseNumberFlexible(document.getElementById('newQty').value);
        const price = parseNumberFlexible(document.getElementById('newPrice').value);
        const amount = qtyReal * price;

        if (!name) {
          alert('Vui lòng nhập tên vật tư!');
          return;
        }

        const key = `${name}___${unit}`;
        manualStock[key] = {
          name,
          unit,
          qtyReal,
          price,
          amount
        };

        await saveToFirebase(PATH.MANUAL, manualStock);
        renderStock();
        popup.remove();
        alert('✅ Đã thêm sản phẩm mới vào tồn kho.');
      });
    }

    // ---------- RENDER LEFT (MÃ PHIẾU) ----------
    function renderLeft() {
      codesDiv.innerHTML = '';
      const keys = Object.keys(allData);
      if (keys.length === 0) {
        codesDiv.innerHTML = '<div class="muted">Chưa có phiếu</div>';
        return;
      }
      keys.sort();
      keys.forEach(code => {
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
            renderLeft();
            renderStock();
          }
        });

        div.appendChild(info);
        div.appendChild(del);
        codesDiv.appendChild(div);
      });
    }

    // ---------- RENDER STOCK (Cập nhật để thêm nút thêm sản phẩm) ----------
    function renderStock() {
      const map = getCurrentStockMap();
      const arr = Object.values(map);
      stockTbody.innerHTML = "";

      if (arr.length === 0) {
        stockTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#777">Chưa có dữ liệu</td></tr>`;
        return;
      }

      arr.forEach((it, idx) => {
        const tr = document.createElement("tr");
        tr.dataset.key = `${it.name}___${it.unit}`;
        
        // Sử dụng qtyReal thay vì real, và tính toán thành tiền đúng
        const soLuongTon = it.qtyReal || 0;
        const donGia = it.price || 0;
        const thanhTien = soLuongTon * donGia;
        
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td contenteditable="true" class="col-name editable">${esc(it.name)}</td>
          <td contenteditable="true" class="col-unit editable">${esc(it.unit)}</td>
          <td contenteditable="true" class="col-qty num editable">${soLuongTon}</td>
          <td contenteditable="true" class="col-price num editable">${donGia}</td>
          <td class="num">${thanhTien.toLocaleString("vi-VN")}</td>
          <td><button class="delRow">🗑️</button></td>
        `;
        stockTbody.appendChild(tr);
      });

      // Thêm nút "Thêm sản phẩm" sau bảng nếu chưa có
      if (!document.getElementById('addStockBtn')) {
        const addBtn = document.createElement('button');
        addBtn.id = 'addStockBtn';
        addBtn.innerHTML = '➕ Thêm sản phẩm mới';
        addBtn.className = 'main-btn';
        addBtn.style.margin = '10px 0';
        addBtn.addEventListener('click', addNewStockItem);
        document.querySelector('#center').appendChild(addBtn);
      }

      // Cho phép chỉnh sửa và lưu tự động
      stockTbody.querySelectorAll("[contenteditable]").forEach((cell) => {
        cell.addEventListener("input", () => {
          clearTimeout(window.saveTimer);
          window.saveTimer = setTimeout(saveEditedStockFromTable, 500);
        });
      });

      // Cho phép xóa sản phẩm
      stockTbody.querySelectorAll(".delRow").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (confirm("Xóa sản phẩm này khỏi tồn kho?")) {
            const key = btn.closest("tr").dataset.key;
            delete manualStock[key];
            await saveToFirebase(PATH.MANUAL, manualStock);
            renderStock();
          }
        });
      });
    }

    async function saveEditedStockFromTable() {
      const rows = document.querySelectorAll("#stockTable tbody tr");
      const obj = {};
      rows.forEach((tr) => {
        const tds = tr.querySelectorAll("td");
        if (tds.length < 6) return;
        const name = tds[1].innerText.trim();
        if (!name) return;
        const unit = tds[2].innerText.trim();
        const qtyReal = Number(tds[3].innerText) || 0; // qtyReal thay vì real
        const price = Number(tds[4].innerText) || 0;
        const amount = qtyReal * price; // tính toán lại amount
        
        obj[`${name}___${unit}`] = { 
          name, 
          unit, 
          qtyReal, // qtyReal thay vì real
          price, 
          amount 
        };
      });
      manualStock = obj;
      await saveToFirebase(PATH.MANUAL, obj);
      renderStock();
    }

    // ---------- Show invoice detail popup ----------
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
            const t = String(cell).toLowerCase();
            if (/stt|no|số/.test(t)) colMap.stt = j;
            else if (/(tên\s*vật\s*tư|tên|vật tư)/.test(t)) colMap.name = j;
            else if (/(đvt|đơn vị)/.test(t)) colMap.unit = j;
            else if (/(sl\s*yêu|số lượng yêu cầu)/.test(t)) colMap.qtyReq = j;
            else if (/(sl\s*thực|số lượng thực)/.test(t)) colMap.qtyReal = j;
            else if (/(đơn giá|price)/.test(t)) colMap.price = j;
            else if (/(thành tiền|total)/.test(t)) colMap.amount = j;
          });

          const items = [];
          for (let i = headerIdx + 1; i < rows.length; i++) {
            let r = rows[i];
            if (!r) continue;
            const text = r.join(' ');
            if (/cộng|tổng/i.test(text)) break;

            // Nếu tên vật tư bị tách sang dòng sau, ghép lại
            if (colMap.name !== undefined && !r[colMap.name] && i + 1 < rows.length) {
              const next = rows[i+1];
              r = [r[0], `${r[1]||''} ${next[0]||next[1]||''}`.trim(), ...(next.slice(2))];
              i++;
            }
            // extract using colMap or fallback positions
            const stt = colMap.stt !== undefined ? r[colMap.stt] : r[0];
            const name = colMap.name !== undefined ? r[colMap.name] : r[1] || r[0];
            const unit = colMap.unit !== undefined ? r[colMap.unit] : r[2] || '';
            const qtyReq = colMap.qtyReq !== undefined ? parseNumberFlexible(r[colMap.qtyReq]) : parseNumberFlexible(r[3]);
            const qtyReal = colMap.qtyReal !== undefined ? parseNumberFlexible(r[colMap.qtyReal]) : parseNumberFlexible(r[4]);
            const price = colMap.price !== undefined ? parseNumberFlexible(r[colMap.price]) : parseNumberFlexible(r[5]);
            const amount = colMap.amount !== undefined ? parseNumberFlexible(r[colMap.amount]) : (qtyReal * price);

            if (!name || String(name).trim() === '') continue;
            items.push({
              stt: stt || items.length + 1,
              name: String(name).trim(),
              unit: String(unit || '').trim(),
              qtyReq,
              qtyReal,
              price,
              amount
            });
          }

          allData[code] = {
            code,
            date: (headerText.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/)||[])[1] || '',
            headerText,
            items
          };
        } catch (err) {
          console.error('Lỗi đọc file', file.name, err);
        }
      }

      await saveToFirebase(PATH.EXCEL, allData);
      renderLeft();
      renderStock();
      // clear input so same file can be re-selected
      excelInput.value = '';
      alert('✅ Đã nhập xong file Excel.');
    });

    // ---------- CLEAR ALL DATA (including history) ----------
    clearBtn.addEventListener('click', async () => {
      if (!confirm('⚠️ Xóa toàn bộ dữ liệu: tồn kho, lịch sử xuất, phòng ban, nhân viên?')) return;
      allData = {};
      manualStock = {};
      await saveToFirebase(PATH.EXCEL, {});
      await saveToFirebase(PATH.HISTORY, []);
      await saveToFirebase(PATH.PHONG, []);
      await saveToFirebase(PATH.TEN, []);
      await saveToFirebase(PATH.MANUAL, {});
      renderLeft();
      renderStock();
      // Sau khi reset dữ liệu, hiển thị màn hình khóa lại
      showLogin();
      alert('🗑️ Đã xóa toàn bộ dữ liệu và reset màn hình khóa.');
    });

    // ---------- POPUP close handlers ----------
    closePopupBtn.addEventListener('click', () => popupDetail.style.display = 'none');
    closeXuatBtn.addEventListener('click', () => xuatPopup.style.display = 'none');
    // click outside to close if clicking on .popup root
    document.addEventListener('click', (ev) => {
      if (ev.target && ev.target.classList && ev.target.classList.contains('popup')) {
        ev.target.style.display = 'none';
      }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (popupDetail.style.display === 'block') popupDetail.style.display = 'none';
        if (xuatPopup.style.display === 'block') xuatPopup.style.display = 'none';
      }
    });

    // ---------- Phòng ban & tên nhân viên helpers ----------
    async function loadPhongVaTen() {
      const phong = await loadFromFirebase(PATH.PHONG, []);
      chonPhong.innerHTML = Array.isArray(phong) ? phong.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('') : '';
      const tenList = await loadFromFirebase(PATH.TEN, []);
      suggestTen.innerHTML = Array.isArray(tenList) ? tenList.map(t => `<option value="${esc(t)}">`).join('') : '';
    }

    async function addPhong(val) {
      const list = await loadFromFirebase(PATH.PHONG, []);
      if (!Array.isArray(list)) return;
      if (!list.includes(val)) {
        list.push(val);
        await saveToFirebase(PATH.PHONG, list);
        loadPhongVaTen();
      }
    }

    async function addTen(val) {
      const list = await loadFromFirebase(PATH.TEN, []);
      if (!Array.isArray(list)) return;
      if (!list.includes(val)) {
        list.push(val);
        await saveToFirebase(PATH.TEN, list);
        loadPhongVaTen();
      }
    }

    themPhongBtn.addEventListener('click', async () => {
      const val = prompt('Nhập tên phòng/ban:');
      if (!val) return;
      await addPhong(val.trim());
    });

    themTenBtn.addEventListener('click', async () => {
      const val = prompt('Nhập tên người nhận:');
      if (!val) return;
      await addTen(val.trim());
    });

    // ---------- Open Xuất popup ----------
    xuatBtn.addEventListener('click', async () => {
      await loadPhongVaTen();
      // populate table
      const map = getCurrentStockMap();
      xuatTableBody.innerHTML = '';
      const arr = Object.values(map);
      arr.forEach((it, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx+1}</td>
          <td>${esc(it.name)}</td>
          <td>${esc(it.unit)}</td>
          <td class="num">${it.qtyReal}</td>
          <td><input type="number" class="slxuat" min="0" max="${it.qtyReal}" data-name="${esc(it.name)}" data-unit="${esc(it.unit)}" style="width:80px"></td>
        `;
        xuatTableBody.appendChild(tr);
      });
      xuatPopup.style.display = 'block';
    });

    // ---------- Confirm XUẤT HÀNG ----------
    confirmXuatBtn.addEventListener('click', async () => {
      const phongVal = chonPhong.value || 'Chưa chọn';
      const nguoiVal = tenNhanInput.value || 'Không rõ';
      const inputs = Array.from(document.querySelectorAll('#xuatTable .slxuat'));
      const xuatList = [];
      inputs.forEach(inp => {
        const qty = parseNumberFlexible(inp.value);
        if (qty > 0) {
          xuatList.push({ name: inp.dataset.name, unit: inp.dataset.unit, qty });
        }
      });
      if (xuatList.length === 0) {
        alert('Chưa nhập số lượng xuất.');
        return;
      }

      // update manual stock map
      const map = getCurrentStockMap();
      xuatList.forEach(x => {
        const key = `${x.name}___${x.unit}`;
        if (!map[key]) return;
        map[key].qtyReal = Math.max(0, Number(map[key].qtyReal) - Number(x.qty));
        map[key].amount = map[key].qtyReal * (Number(map[key].price) || 0);
      });
      // save updated map to PATH.MANUAL
      manualStock = map;
      await saveToFirebase(PATH.MANUAL, map);
      renderStock();

      // save history - FIX: Thống nhất array cho cả Firebase và local
      const historyItem = {
        id: Date.now(),
        phong: phongVal,
        nguoi: nguoiVal,
        ngay: new Date().toLocaleString('vi-VN'),
        ngayISO: new Date().toISOString(),
        danhSach: xuatList
      };

      if (useLocalStorage) {
        const history = loadLocal(PATH.HISTORY, []);
        history.push(historyItem);
        saveLocal(PATH.HISTORY, history);
      } else {
        // Firebase: push tạo object, nhưng ta sẽ lưu như array bằng set (append)
        const historyRef = ref(db, PATH.HISTORY);
        const currentHistory = await get(historyRef);
        const historyArray = currentHistory.val() ? Object.values(currentHistory.val()) : [];
        historyArray.push(historyItem);
        await set(historyRef, historyArray);  // Sửa: Dùng set với array thay vì push
      }

      alert('✅ Đã xuất hàng và lưu lịch sử.');
      xuatPopup.style.display = 'none';
    });

    // ---------- View history (grouped by phong) with filter (default grouped view) ----------
    viewPhieuBtn.addEventListener('click', async () => {
      let allHistory;
      if (useLocalStorage) {
        allHistory = loadLocal(PATH.HISTORY, []);
      } else {
        const historyData = await loadFromFirebase(PATH.HISTORY, []);
        // FIX: Nếu Firebase lưu như object (từ push cũ), chuyển thành array
        allHistory = Array.isArray(historyData) ? historyData : Object.values(historyData || {});
      }
      if (!Array.isArray(allHistory) || !allHistory.length) return alert('Chưa có lịch sử xuất hàng.');
      const phongList = [...new Set(allHistory.map(h => h.phong))].sort();
      const nguoiList = [...new Set(allHistory.map(h => h.nguoi))].sort();

      // build popup
      const popup = document.createElement('div');
      popup.className = 'popup';
      popup.style.display = 'block';
      popup.innerHTML = `
        <header>📋 Lịch sử xuất hàng <span id="closeHis">✖</span></header>
        <div class="body" style="padding:10px;max-height:80vh;overflow:auto;">
          <div id="filterBar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
            <label>📅 Từ: <input type="date" id="fromDate"></label>
            <label>Đến: <input type="date" id="toDate"></label>
            <label>🏢 Phòng:
              <select id="filterPhong"><option value="">-- Tất cả --</option>${phongList.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>
            </label>
            <label>👤 Nhân viên:
              <select id="filterNguoi"><option value="">-- Tất cả --</option>${nguoiList.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>
            </label>
            <button id="btnLoc" class="main-btn">🔍 Lọc</button>
          </div>
          <div id="hisContainer"></div>
        </div>
      `;
      document.body.appendChild(popup);
      document.getElementById('closeHis').addEventListener('click', ()=> popup.remove());

      // parsing date helper within this scope
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

        // grouped view (phòng -> item map)
        const grouped = {};
        filtered.forEach(h => {
          if (!grouped[h.phong]) grouped[h.phong] = [];
          grouped[h.phong].push(h);
        });

        let html = '';
        Object.entries(grouped).forEach(([phong, arr]) => {
          html += `<div class="phong-block" style="margin-bottom:18px;">
            <h4 style="background:#2196f3;color:#fff;padding:6px 10px;border-radius:4px;">🏢 ${esc(phong)}</h4>
            <table style="width:100%;border-collapse:collapse;margin-top:6px;">
              <thead><tr style="background:#f0f0f0;text-align:left;">
                <th style="padding:6px;">Tên vật tư</th><th style="width:100px;padding:6px;">Tổng SL</th><th style="padding:6px;">Chi tiết nhận</th>
              </tr></thead><tbody>`;
          // items map
          const m = {};
          arr.forEach(h => {
            (h.danhSach || []).forEach(it => {
              const key = `${it.name}___${it.unit}`;
              if (!m[key]) m[key] = { name: it.name, unit: it.unit, tong: 0, chiTiet: [] };
              m[key].tong += Number(it.qty) || 0;
              m[key].chiTiet.push({ ngay: h.ngay, nguoi: h.nguoi, sl: it.qty, ngayISO: h.ngayISO });
            });
          });

          Object.values(m).forEach(it => {
            const details = it.chiTiet.map(c => `• ${esc(c.ngay)} – ${esc(c.nguoi)}: ${c.sl}`).join('<br>');
            html += `<tr><td style="padding:6px;border-bottom:1px solid #eee;">${esc(it.name)} (${esc(it.unit)})</td>
              <td style="padding:6px;border-bottom:1px solid #eee;text-align:center;">${it.tong}</td>
              <td style="padding:6px;border-bottom:1px solid #eee;">${details}</td></tr>`;
          });

          html += '</tbody></table></div>';
        });

        document.getElementById('hisContainer').innerHTML = html || '<div style="color:#777">Không có dữ liệu phù hợp.</div>';
      }

      document.getElementById('btnLoc').addEventListener('click', applyFilterAndRender);
      applyFilterAndRender(); // initial render
    });

    // ---------- initial render ----------
    allData = await loadFromFirebase(PATH.EXCEL, {});
    manualStock = await loadFromFirebase(PATH.MANUAL, {});
    await loadPhongVaTen();
    renderLeft();
    renderStock();

    // Listen to changes (if not fallback)
    if (!useLocalStorage) {
      listenToFirebase(PATH.EXCEL, (data) => { allData = data; renderLeft(); renderStock(); });
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
});