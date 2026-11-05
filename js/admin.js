// Кабинет гида
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const starsText = (n) => "★".repeat(n) + "☆".repeat(5 - n);
  const today = () => new Date().toISOString().slice(0, 10);
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  const state = {
    tab: "tours", bars: [], tours: [], reviews: [],
    editBar: null, editTour: null, qrOpen: null, filterTour: ""
  };

  let toastTimer;
  function toast(msg, bad) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = "toast"), 2800);
  }
  function errMsg(e) {
    const m = (e && (e.message || e.details)) || String(e);
    if (/duplicate key|unique/i.test(m)) return "Такой код уже занят другой экскурсией.";
    if (/foreign key|violates/i.test(m)) return "У этого бара уже есть отзывы — его нельзя удалить.";
    return "Ошибка: " + m;
  }
  function fmtDate(d) {
    const dt = new Date(d + "T12:00:00");
    return isNaN(dt) ? d : dt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }
  function fmtTime(s) {
    const d = new Date(s);
    return isNaN(d) ? "" : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function tourLink(code) {
    const u = new URL("index.html", location.href);
    u.search = "?tour=" + encodeURIComponent(code);
    return u.toString();
  }
  function genCode(date) {
    const d = new Date((date || today()) + "T12:00:00");
    const base = MONTHS[d.getMonth()] + String(d.getDate()).padStart(2, "0");
    if (!state.tours.some((t) => t.code.toUpperCase() === base && t.id !== state.editTour?.id)) return base;
    for (let i = 2; i < 50; i++) {
      const c = base + "-" + i;
      if (!state.tours.some((t) => t.code.toUpperCase() === c && t.id !== state.editTour?.id)) return c;
    }
    return base + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
  }
  const barName = (id) => state.bars.find((b) => b.id === id)?.name || "—";
  const tourById = (id) => state.tours.find((t) => t.id === id);
  const rev = (tour) => Math.min(tour.revealed ?? 1, tour.bar_ids.length);

  // ---------- вход ----------
  async function start() {
    $("#demo").innerHTML = DB.mode === "demo"
      ? `<div class="banner">Демо-режим: данные хранятся только в этом браузере. Чтобы отзывы гостей приходили к вам, подключите Supabase (см. README).</div>`
      : "";
    const session = await DB.getSession();
    if (!session) return loginScreen();
    if (DB.mode !== "demo") $("#who").innerHTML = `<button class="btn sm ghost" id="logout">Выйти</button>`;
    $("#logout")?.addEventListener("click", async () => { await DB.signOut(); location.reload(); });
    await reload();
  }

  function loginScreen() {
    app.innerHTML = `
      <section class="card login">
        <h2>Вход для гида</h2>
        <form id="loginForm">
          <label class="field"><span>Email</span><input type="email" id="email" required autocomplete="username"></label>
          <label class="field"><span>Пароль</span><input type="password" id="pw" required autocomplete="current-password"></label>
          <p class="err" id="loginErr"></p>
          <button class="btn primary block" type="submit">Войти</button>
        </form>
      </section>`;
    $("#loginForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await DB.signIn($("#email").value.trim(), $("#pw").value);
        location.reload();
      } catch (err) {
        $("#loginErr").textContent = "Неверный email или пароль.";
      }
    };
  }

  async function reload() {
    try {
      const [bars, tours, reviews] = await Promise.all([DB.listBars(), DB.listTours(), DB.listReviews()]);
      Object.assign(state, { bars, tours, reviews });
    } catch (e) {
      console.error(e);
      app.innerHTML = `<section class="card"><p class="err">${esc(errMsg(e))}</p>
        <p class="muted small">Если вы только что вошли — проверьте, что ваш email добавлен в таблицу admins (см. README).</p></section>`;
      return;
    }
    render();
  }

  // ---------- отрисовка ----------
  function render() {
    app.innerHTML = `
      <nav class="tabs">
        <button data-action="tab" data-tab="tours" class="${state.tab === "tours" ? "on" : ""}">🗺 Экскурсии</button>
        <button data-action="tab" data-tab="bars" class="${state.tab === "bars" ? "on" : ""}">🍸 Бары</button>
        <button data-action="tab" data-tab="reviews" class="${state.tab === "reviews" ? "on" : ""}">💬 Отзывы (${state.reviews.length})</button>
      </nav>
      ${state.tab === "tours" ? toursTab() : state.tab === "bars" ? barsTab() : reviewsTab()}`;
    if (state.qrOpen) drawQr(state.qrOpen);
  }

  // --- Бары ---
  function barsTab() {
    const b = state.editBar || {};
    return `
      <section class="card">
        <h2>${b.id ? "Изменить бар" : "Добавить бар"}</h2>
        <form id="barForm">
          <label class="field"><span>Название *</span><input type="text" name="name" required maxlength="100" value="${esc(b.name || "")}"></label>
          <label class="field"><span>Адрес</span><input type="text" name="address" maxlength="200" value="${esc(b.address || "")}" placeholder="ул. Панфилова, 100"></label>
          <label class="field"><span>Ссылка на карту (2ГИС / Google / Яндекс) — необязательно</span><input type="url" name="map_url" maxlength="500" value="${esc(b.map_url || "")}" placeholder="https://2gis.kz/almaty/..."></label>
          <div class="row">
            <button class="btn primary" type="submit">${b.id ? "Сохранить" : "Добавить"}</button>
            ${b.id ? `<button class="btn ghost" type="button" data-action="cancel-bar">Отмена</button>` : ""}
          </div>
        </form>
      </section>
      <section class="card">
        <h2>Все бары (${state.bars.length})</h2>
        ${state.bars.length ? state.bars.map((x) => {
          const rs = state.reviews.filter((r) => r.bar_id === x.id);
          const avg = rs.length ? (rs.reduce((s, r) => s + r.rating, 0) / rs.length).toFixed(1) : null;
          return `
          <div class="list-item">
            <div class="main">
              <div class="title">${esc(x.name)}</div>
              <div class="muted small">${esc(x.address || "")}</div>
              <div class="small">${avg ? `<span class="st">★ ${avg}</span> · отзывов: ${rs.length}` : `<span class="muted">отзывов пока нет</span>`}</div>
            </div>
            <div class="row">
              <button class="btn sm" data-action="edit-bar" data-id="${x.id}">Изменить</button>
              <button class="btn sm danger" data-action="del-bar" data-id="${x.id}">Удалить</button>
            </div>
          </div>`;
        }).join("") : `<p class="muted">Добавьте бары, по которым вы водите экскурсии.</p>`}
      </section>`;
  }

  // --- Экскурсии ---
  function toursTab() {
    const tr = state.editTour;
    return `
      ${tr ? tourForm(tr) : `<button class="btn primary block" style="margin-top:14px" data-action="new-tour">+ Новая экскурсия</button>`}
      <section class="card">
        <h2>Экскурсии</h2>
        ${state.tours.length ? state.tours.map((x) => {
          const n = new Set(state.reviews.filter((r) => r.tour_id === x.id).map((r) => r.guest_id)).size;
          return `
          <div class="list-item">
            <div class="main">
              <div><span class="tag">${esc(x.code)}</span> &nbsp;<strong>${esc(fmtDate(x.tour_date))}</strong>${x.title ? " · " + esc(x.title) : ""}</div>
              <div class="muted small" style="margin-top:4px">${x.bar_ids.map((id, i) => i < rev(x) ? `<span style="color:var(--text)">${i + 1}. ${esc(barName(id))}</span>` : `🔒 ${i + 1}. ${esc(barName(id))}`).join(" → ") || "маршрут пуст"}</div>
              <div class="small" style="margin-top:2px">Гостей оставили отзывы: <strong>${n}</strong></div>
              <div class="reveal">
                <span class="small">Гости видят: <strong>${rev(x)} из ${x.bar_ids.length}</strong></span>
                ${rev(x) < x.bar_ids.length ? `<button class="btn sm primary" data-action="reveal" data-id="${x.id}" data-n="${rev(x) + 1}">Открыть следующий: ${esc(barName(x.bar_ids[rev(x)]))} ▶</button>` : `<span class="tag g">весь маршрут открыт</span>`}
                ${rev(x) > 1 ? `<button class="btn sm ghost" data-action="reveal" data-id="${x.id}" data-n="${rev(x) - 1}" title="Спрятать последний открытый бар">↩ Спрятать</button>` : ""}
              </div>
            </div>
            <div class="row">
              <button class="btn sm green" data-action="qr" data-id="${x.id}">QR и ссылка</button>
              <button class="btn sm" data-action="tour-reviews" data-id="${x.id}">Отзывы</button>
              <button class="btn sm" data-action="edit-tour" data-id="${x.id}">Изменить</button>
              <button class="btn sm danger" data-action="del-tour" data-id="${x.id}">Удалить</button>
            </div>
            ${state.qrOpen === x.id ? `
              <div class="qr-box" style="flex-basis:100%">
                <div class="qr" id="qr-${x.id}"></div>
                <div class="info">
                  <div class="small muted">Покажите гостям QR-код или отправьте ссылку в чат группы. Код экскурсии: <strong>${esc(x.code)}</strong></div>
                  <div class="linkbox"><input type="text" readonly value="${esc(tourLink(x.code))}"><button class="btn sm" data-action="copy" data-text="${esc(tourLink(x.code))}">Копировать</button></div>
                  <div class="row" style="margin-top:10px"><button class="btn sm" data-action="dl-qr" data-id="${x.id}">⬇ Скачать QR</button>
                  <a class="btn sm ghost" href="${esc(tourLink(x.code))}" target="_blank" rel="noopener">Открыть как гость ↗</a></div>
                </div>
              </div>` : ""}
          </div>`;
        }).join("") : `<p class="muted">Пока нет экскурсий. Сначала добавьте бары во вкладке «Бары», затем создайте экскурсию.</p>`}
      </section>`;
  }

  function tourForm(tr) {
    const available = state.bars.filter((b) => !tr.bar_ids.includes(b.id));
    return `
      <section class="card">
        <h2>${tr.id ? "Изменить экскурсию" : "Новая экскурсия"}</h2>
        <div class="row">
          <label class="field grow"><span>Дата</span><input type="date" id="t-date" value="${esc(tr.tour_date)}"></label>
          <label class="field grow"><span>Код для гостей</span><input type="text" id="t-code" maxlength="20" value="${esc(tr.code)}" style="text-transform:uppercase;font-weight:800;letter-spacing:2px"></label>
        </div>
        <label class="field"><span>Заметка (видят гости) — необязательно</span><input type="text" id="t-title" maxlength="100" value="${esc(tr.title || "")}" placeholder="Например: Вечер пятницы"></label>
        <span class="lbl">Маршрут — в порядке посещения</span>
        <div class="route">
          ${tr.bar_ids.length ? tr.bar_ids.map((id, i) => `
            <div class="route-item">
              <span class="n">${i + 1}</span><span class="nm">${esc(barName(id))}</span>
              <button class="icon-btn" title="Выше" data-action="up" data-i="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
              <button class="icon-btn" title="Ниже" data-action="down" data-i="${i}" ${i === tr.bar_ids.length - 1 ? "disabled" : ""}>↓</button>
              <button class="icon-btn" title="Убрать" data-action="rm-stop" data-i="${i}">✕</button>
            </div>`).join("") : `<div class="muted small">Добавьте бары ниже</div>`}
        </div>
        ${available.length ? `
          <div class="row">
            <select id="t-add" class="grow"><option value="">— выберите бар —</option>${available.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select>
            <button class="btn" data-action="add-stop">+ Добавить</button>
          </div>` : state.bars.length ? "" : `<p class="muted small">Сначала добавьте бары во вкладке «Бары».</p>`}
        <p class="err" id="t-err"></p>
        <div class="row">
          <button class="btn primary" data-action="save-tour">Сохранить экскурсию</button>
          <button class="btn ghost" data-action="cancel-tour">Отмена</button>
        </div>
      </section>`;
  }

  function syncTourForm() {
    const tr = state.editTour;
    if (!tr || !$("#t-date")) return;
    tr.tour_date = $("#t-date").value || today();
    tr.code = $("#t-code").value.trim().toUpperCase();
    tr.title = $("#t-title").value.trim();
  }

  function drawQr(id) {
    const tr = tourById(id);
    const el = document.getElementById("qr-" + id);
    if (!tr || !el || !window.QRCode) return;
    el.innerHTML = "";
    new QRCode(el, { text: tourLink(tr.code), width: 480, height: 480, colorDark: "#0c271d", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
  }

  // --- Отзывы ---
  function reviewsTab() {
    const list = state.reviews.filter((r) => !state.filterTour || r.tour_id === state.filterTour);
    const byBar = {};
    list.forEach((r) => ((byBar[r.bar_id] = byBar[r.bar_id] || []).push(r)));
    const guests = new Set(list.map((r) => r.guest_id)).size;
    const avgAll = list.length ? (list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(1) : "—";
    return `
      <section class="card">
        <div class="row">
          <select id="f-tour" class="grow">
            <option value="">Все экскурсии</option>
            ${state.tours.map((x) => `<option value="${x.id}" ${state.filterTour === x.id ? "selected" : ""}>${esc(x.code)} · ${esc(fmtDate(x.tour_date))}</option>`).join("")}
          </select>
          <button class="btn" data-action="csv" ${list.length ? "" : "disabled"}>⬇ Скачать таблицу (CSV)</button>
          <button class="btn ghost" data-action="refresh">↻ Обновить</button>
        </div>
        <div class="stats" style="margin-top:14px">
          <div class="stat"><div class="v">${list.length}</div><div class="muted small">отзывов</div></div>
          <div class="stat"><div class="v">${guests}</div><div class="muted small">гостей</div></div>
          <div class="stat"><div class="v">★ ${avgAll}</div><div class="muted small">средняя оценка</div></div>
        </div>
      </section>
      ${Object.keys(byBar).length ? `
      <section class="card">
        <h2>Рейтинг баров</h2>
        <div class="stats">
          ${Object.entries(byBar).map(([id, rs]) => ({ id, rs, avg: rs.reduce((s, r) => s + r.rating, 0) / rs.length }))
            .sort((a, b) => b.avg - a.avg)
            .map(({ id, rs, avg }) => `<div class="stat"><div class="v">★ ${avg.toFixed(1)}</div><div><strong>${esc(barName(id))}</strong></div><div class="muted small">отзывов: ${rs.length}</div></div>`).join("")}
        </div>
      </section>` : ""}
      <section class="card">
        <h2>Все отзывы</h2>
        ${list.length ? list.map((r) => `
          <div class="review">
            <div><strong>${esc(r.guest_name)}</strong> о <strong>${esc(barName(r.bar_id))}</strong> &nbsp;<span class="st">${starsText(r.rating)}</span></div>
            <div class="meta">${esc(tourById(r.tour_id)?.code || "")} · ${esc(fmtTime(r.updated_at || r.created_at))}</div>
            ${r.cocktails?.length ? `<ul>${r.cocktails.map((c) => `<li>${esc(c.name)}${c.rating ? ` <span class="st">${"★".repeat(c.rating)}</span>` : ""}${c.note ? ` — <span class="muted">${esc(c.note)}</span>` : ""}</li>`).join("")}</ul>` : ""}
            ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}
          </div>`).join("") : `<p class="muted">Отзывов пока нет.</p>`}
      </section>`;
  }

  function downloadCsv() {
    const list = state.reviews.filter((r) => !state.filterTour || r.tour_id === state.filterTour);
    const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const rows = [["Дата экскурсии", "Код", "Гость", "Бар", "Оценка бара", "Отзыв", "Коктейли", "Время"]];
    list.forEach((r) => {
      const tr = tourById(r.tour_id);
      rows.push([
        tr?.tour_date || "", tr?.code || "", r.guest_name, barName(r.bar_id), r.rating, r.comment || "",
        (r.cocktails || []).map((c) => c.name + (c.rating ? ` (${c.rating}/5)` : "") + (c.note ? ` — ${c.note}` : "")).join("; "),
        fmtTime(r.updated_at || r.created_at)
      ]);
    });
    const csv = "﻿" + rows.map((r) => r.map(q).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "otzyvy-" + today() + ".csv";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- события ----------
  app.addEventListener("submit", async (e) => {
    if (e.target.id !== "barForm") return;
    e.preventDefault();
    const f = new FormData(e.target);
    const bar = { name: f.get("name").trim(), address: f.get("address").trim(), map_url: f.get("map_url").trim() };
    if (!bar.name) return;
    if (state.editBar?.id) bar.id = state.editBar.id;
    try {
      await DB.saveBar(bar);
      state.editBar = null;
      toast(bar.id ? "Бар обновлён" : "Бар добавлен");
      await reload();
    } catch (err) { toast(errMsg(err), true); }
  });

  app.addEventListener("change", (e) => {
    if (e.target.id === "f-tour") { state.filterTour = e.target.value; render(); }
    if (e.target.id === "t-date" && state.editTour && !state.editTour.id && !state.editTour.codeTouched) {
      syncTourForm();
      state.editTour.code = genCode(state.editTour.tour_date);
      $("#t-code").value = state.editTour.code;
    }
  });
  app.addEventListener("input", (e) => {
    if (e.target.id === "t-code" && state.editTour) state.editTour.codeTouched = true;
  });

  app.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action, id = el.dataset.id;
    const tr = state.editTour;

    switch (a) {
      case "tab": state.tab = el.dataset.tab; render(); break;
      case "edit-bar": state.editBar = { ...state.bars.find((b) => b.id === id) }; render(); window.scrollTo({ top: 0, behavior: "smooth" }); break;
      case "cancel-bar": state.editBar = null; render(); break;
      case "del-bar":
        if (!confirm("Удалить бар «" + barName(id) + "»?")) return;
        try { await DB.deleteBar(id); toast("Бар удалён"); await reload(); } catch (err) { toast(errMsg(err), true); }
        break;

      case "new-tour": {
        state.editTour = { tour_date: today(), code: "", title: "", bar_ids: [] };
        state.editTour.code = genCode(today());
        render(); break;
      }
      case "edit-tour": {
        const x = tourById(id);
        state.editTour = { ...x, bar_ids: [...x.bar_ids], codeTouched: true };
        render(); window.scrollTo({ top: 0, behavior: "smooth" }); break;
      }
      case "cancel-tour": state.editTour = null; render(); break;
      case "add-stop": {
        syncTourForm();
        const v = $("#t-add").value;
        if (v) { tr.bar_ids.push(v); render(); }
        break;
      }
      case "up": case "down": {
        syncTourForm();
        const i = +el.dataset.i, j = a === "up" ? i - 1 : i + 1;
        [tr.bar_ids[i], tr.bar_ids[j]] = [tr.bar_ids[j], tr.bar_ids[i]];
        render(); break;
      }
      case "rm-stop": syncTourForm(); tr.bar_ids.splice(+el.dataset.i, 1); render(); break;
      case "save-tour": {
        syncTourForm();
        if (!/^[A-Z0-9-]{2,20}$/.test(tr.code)) { $("#t-err").textContent = "Код: 2–20 символов, только латинские буквы, цифры и дефис."; return; }
        if (!tr.bar_ids.length) { $("#t-err").textContent = "Добавьте в маршрут хотя бы один бар."; return; }
        try {
          await DB.saveTour({ id: tr.id, code: tr.code, tour_date: tr.tour_date, title: tr.title, bar_ids: tr.bar_ids });
          const code = tr.code;
          state.editTour = null;
          toast("Экскурсия сохранена");
          await reload();
          const saved = state.tours.find((x) => x.code === code);
          if (saved) { state.qrOpen = saved.id; render(); }
        } catch (err) { $("#t-err").textContent = errMsg(err); }
        break;
      }
      case "del-tour": {
        const n = state.reviews.filter((r) => r.tour_id === id).length;
        if (!confirm("Удалить экскурсию " + tourById(id).code + "?" + (n ? `\nВместе с ней удалятся ${n} отзывов!` : ""))) return;
        try { await DB.deleteTour(id); toast("Экскурсия удалена"); await reload(); } catch (err) { toast(errMsg(err), true); }
        break;
      }
      case "reveal": {
        const n = +el.dataset.n;
        const x = tourById(id);
        const prev = rev(x);
        el.disabled = true;
        try {
          await DB.setRevealed(id, n);
          x.revealed = n;
          render();
          toast(n > prev ? "Гости видят: " + barName(x.bar_ids[n - 1]) : "Бар снова спрятан");
        } catch (err) { el.disabled = false; toast(errMsg(err), true); }
        break;
      }
      case "qr": state.qrOpen = state.qrOpen === id ? null : id; render(); break;
      case "dl-qr": {
        const box = document.getElementById("qr-" + id);
        const src = box?.querySelector("canvas")?.toDataURL("image/png") || box?.querySelector("img")?.src;
        if (!src) return;
        const link = document.createElement("a");
        link.href = src; link.download = "qr-" + tourById(id).code + ".png";
        document.body.appendChild(link); link.click(); link.remove();
        break;
      }
      case "copy":
        try { await navigator.clipboard.writeText(el.dataset.text); toast("Ссылка скопирована"); }
        catch (err) { el.previousElementSibling?.select(); document.execCommand("copy"); toast("Ссылка скопирована"); }
        break;
      case "tour-reviews": state.filterTour = id; state.tab = "reviews"; render(); break;
      case "csv": downloadCsv(); break;
      case "refresh": await reload(); toast("Обновлено"); break;
    }
  });

  start().catch((e) => {
    console.error(e);
    app.innerHTML = `<section class="card"><p class="err">Не удалось подключиться. Проверьте интернет и обновите страницу.</p></section>`;
  });
})();
