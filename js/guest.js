// Страница гостя
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");
  const params = new URLSearchParams(location.search);
  const state = { tour: null, guest: null, reviews: {}, open: null, tab: "bars", drafts: {}, view: null, photos: [], photosLoaded: false, uploading: false };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  const starsText = (n) => "★".repeat(n) + "☆".repeat(5 - n);
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function fmtDate(d) {
    if (!d) return "";
    const dt = new Date(d + "T12:00:00");
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString(CURRENT_LANG === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  let toastTimer;
  function toast(msg, bad) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = "toast" + (bad ? " bad" : "")), msg.length > 40 ? 5000 : 2600);
  }

  // ---------- язык ----------
  function applyLang(lang) {
    window.CURRENT_LANG = lang;
    setLang(lang);
    document.querySelectorAll("#lang button").forEach((b) => b.classList.toggle("on", b.dataset.lang === lang));
    document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
    $("#demo").innerHTML = DB.mode === "demo" ? `<div class="banner">${esc(t("demo"))}</div>` : "";
    if (state.view) state.view();
  }
  $("#lang").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-lang]");
    if (b) applyLang(b.dataset.lang);
  });

  // ---------- экраны ----------
  function show(view) { state.view = view; view(); }

  function codeScreen(errMsg) {
    show(() => {
      app.innerHTML = `
        <section class="card hero">
          <div class="emoji-big">🍹</div>
          <h1>${esc(t("enterCode"))}</h1>
          <p>${esc(t("codeHint"))}</p>
          <form id="codeForm">
            <input class="code-input" id="code" type="text" autocomplete="off" autocapitalize="characters" placeholder="${esc(t("codePh"))}" value="${esc(params.get("tour") || "")}">
            <p class="err">${errMsg ? esc(errMsg) : ""}</p>
            <button class="btn primary block" type="submit">${esc(t("go"))}</button>
          </form>
        </section>`;
      $("#codeForm").onsubmit = (e) => {
        e.preventDefault();
        const code = $("#code").value.trim();
        if (!code) return;
        params.set("tour", code.toUpperCase());
        params.delete("g");
        history.replaceState(null, "", "?" + params.toString());
        loadTour(code);
      };
    });
  }

  function nameScreen() {
    show(() => {
      const tour = state.tour;
      app.innerHTML = `
        <section class="card hero">
          <div class="emoji-big">🥂</div>
          <h1>${esc(t("welcome"))}</h1>
          <p>${esc(t("welcomeText"))}</p>
          <p class="small"><span class="tag">${esc(tour.code)}</span> &nbsp;${esc(fmtDate(tour.date))}${tour.title ? " · " + esc(tour.title) : ""}</p>
          <form id="nameForm">
            <label class="field"><span>${esc(t("yourName"))}</span>
              <input id="name" type="text" maxlength="60" autocomplete="given-name" placeholder="${esc(t("namePh"))}" value="${esc(state.guest?.name || "")}">
            </label>
            <button class="btn primary block" type="submit">${esc(t("start"))} 🍸</button>
          </form>
        </section>`;
      $("#nameForm").onsubmit = (e) => {
        e.preventDefault();
        const name = $("#name").value.trim();
        if (!name) return $("#name").focus();
        state.guest = { id: state.guest?.id || uuid(), name };
        lsSet("cwl_guest_" + tour.code.toUpperCase(), state.guest);
        state.open = (tour.bars.find((b) => !state.reviews[b.id]) || {}).id || null;
        mainScreen();
      };
      setTimeout(() => $("#name")?.focus(), 50);
    });
  }

  function mainScreen() {
    show(renderMain);
  }

  function renderMain() {
    const { tour, guest } = state;
    const done = tour.bars.filter((b) => state.reviews[b.id]).length;
    const total = tour.total;
    app.innerHTML = `
      <div class="greet">
        <h1>${esc(t("hi", { name: guest.name }))}</h1>
        <span class="muted small">${esc(fmtDate(tour.date))}</span>
      </div>
      <div class="muted small" style="margin-top:4px">${esc(t("progress", { a: done, b: total }))}</div>
      <div class="progress"><div style="width:${total ? (done / total) * 100 : 0}%"></div></div>
      <nav class="tabs">
        <button type="button" data-action="tab" data-tab="bars" class="${state.tab === "bars" ? "on" : ""}">🍸 ${esc(t("tabBars"))}</button>
        <button type="button" data-action="tab" data-tab="photos" class="${state.tab === "photos" ? "on" : ""}">📸 ${esc(t("tabPhotos"))}</button>
        <button type="button" data-action="tab" data-tab="my" class="${state.tab === "my" ? "on" : ""}">💗 ${esc(t("tabMy"))}</button>
      </nav>
      <div id="tab">${state.tab === "bars" ? barsTab() : state.tab === "photos" ? photosTab() : myTab()}</div>`;
  }

  function barsTab() {
    const { bars, total } = state.tour;
    let h = bars.map((bar, i) => barCard(bar, i)).join("");
    for (let i = bars.length; i < total; i++) {
      h += `
        <article class="bar secret">
          <div class="bar-head">
            <span class="stop-num">?</span>
            <span class="bar-title">
              <span class="small muted">${esc(t("stop"))} ${i + 1}</span>
              <span class="bar-name">🤫 ${esc(t("secretStop"))}</span>
              ${i === bars.length ? `<span class="bar-sub">${esc(t("secretText"))}</span>` : ""}
            </span>
          </div>
        </article>`;
    }
    return h;
  }

  function barCard(bar, i) {
    const r = state.reviews[bar.id];
    const open = state.open === bar.id;
    const sub = r
      ? `<span class="st">${starsText(r.rating)}</span>${r.cocktails?.length ? " · " + esc(t("cocktailsN", { n: r.cocktails.length })) : ""}`
      : esc(t("notRated"));
    const community = bar.count ? `<span class="bar-sub community">${esc(t("communityRating", { avg: Number(bar.avg).toFixed(1), n: bar.count }))}</span>` : "";
    return `
      <article class="bar ${open ? "open" : ""} ${r ? "done" : ""}" data-bar="${bar.id}">
        <button type="button" class="bar-head" data-action="toggle">
          <span class="stop-num">${r ? "✓" : i + 1}</span>
          <span class="bar-title">
            <span class="small muted">${esc(t("stop"))} ${i + 1}</span>
            <span class="bar-name">${esc(bar.name)}</span>
            <span class="bar-sub">${sub}</span>
            ${community}
          </span>
          <span class="chev">›</span>
        </button>
        ${open ? barForm(bar) : ""}
      </article>`;
  }

  function mapUrl(bar) {
    if (bar.map_url) return bar.map_url;
    if (bar.address) return "https://2gis.kz/almaty/search/" + encodeURIComponent(bar.name + " " + bar.address);
    return "";
  }

  function getDraft(barId) {
    if (!state.drafts[barId]) {
      const r = state.reviews[barId];
      state.drafts[barId] = r
        ? { rating: r.rating, comment: r.comment || "", cocktails: (r.cocktails || []).map((c) => ({ ...c })) }
        : { rating: 0, comment: "", cocktails: [] };
      if (!state.drafts[barId].cocktails.length) state.drafts[barId].cocktails.push({ name: "", rating: 0, note: "" });
    }
    return state.drafts[barId];
  }

  function stars(key, value, small) {
    let h = `<div class="stars ${small ? "sm" : ""}" role="radiogroup">`;
    for (let v = 1; v <= 5; v++) {
      h += `<button type="button" aria-label="${v}" data-action="star" data-key="${key}" data-v="${v}" class="${v <= value ? "on" : ""}">★</button>`;
    }
    return h + "</div>";
  }

  function barForm(bar) {
    const d = getDraft(bar.id);
    const url = mapUrl(bar);
    return `
      <div class="bar-body">
        ${url ? `<a class="map-link" href="${esc(url)}" target="_blank" rel="noopener">📍 ${esc(bar.address || t("openMap"))}</a>` : ""}
        <span class="lbl">${esc(t("rateBar"))}</span>
        ${stars("bar", d.rating)}
        <span class="lbl">${esc(t("cocktails"))}</span>
        ${d.cocktails.map((c, j) => `
          <div class="cocktail">
            <input type="text" maxlength="80" data-field="c-name" data-i="${j}" value="${esc(c.name)}" placeholder="${esc(t("cocktailName"))}">
            <div class="row">
              ${stars("c" + j, c.rating, true)}
              ${d.cocktails.length > 1 ? `<button type="button" class="btn sm ghost" data-action="rm-cocktail" data-i="${j}">${esc(t("remove"))}</button>` : ""}
            </div>
            <textarea maxlength="500" data-field="c-note" data-i="${j}" placeholder="${esc(t("cocktailNote"))}">${esc(c.note || "")}</textarea>
          </div>`).join("")}
        ${d.cocktails.length < 10 ? `<button type="button" class="btn sm ghost" data-action="add-cocktail">${esc(t("addCocktail"))}</button>` : ""}
        <span class="lbl">${esc(t("comment"))}</span>
        <textarea maxlength="2000" data-field="comment" placeholder="${esc(t("commentPh"))}">${esc(d.comment)}</textarea>
        <p class="err" data-err></p>
        <button type="button" class="btn primary block" data-action="save">${esc(t("save"))}</button>
      </div>`;
  }

  function allCocktails() {
    const list = [];
    state.tour.bars.forEach((b) => (state.reviews[b.id]?.cocktails || []).forEach((c) => list.push({ ...c, bar: b.name })));
    return list;
  }
  function favorite() {
    const list = allCocktails().filter((c) => c.rating > 0);
    if (!list.length) return null;
    return list.reduce((best, c) => (c.rating > best.rating ? c : best), list[0]);
  }
  function personalLink() {
    const u = new URL(location.href);
    u.search = "?tour=" + encodeURIComponent(state.tour.code) + "&g=" + state.guest.id;
    u.hash = "";
    return u.toString();
  }

  function myTab() {
    const rated = state.tour.bars.map((b, i) => ({ b, i, r: state.reviews[b.id] })).filter((x) => x.r);
    if (!rated.length) {
      return `<section class="card hero"><div class="emoji-big">🍋</div><p>${esc(t("myEmpty"))}</p>
        <button class="btn primary" data-action="tab" data-tab="bars">${esc(t("goToBars"))}</button></section>`;
    }
    const fav = favorite();
    return `
      ${fav ? `<section class="card fav">
        <div class="k">${esc(t("favorite"))}</div>
        <div class="v">${esc(fav.name)}</div>
        <div class="muted small">${esc(fav.bar)} · <span class="st">${starsText(fav.rating)}</span></div>
      </section>` : ""}
      <section class="card">
        ${rated.map(({ b, i, r }) => `
          <div class="sum-item">
            <span class="stop-num">${i + 1}</span>
            <div style="flex:1;min-width:0">
              <strong>${esc(b.name)}</strong> &nbsp;<span class="st">${starsText(r.rating)}</span>
              ${r.cocktails?.length ? `<ul>${r.cocktails.map((c) => `<li>${esc(c.name)}${c.rating ? ` <span class="st">${"★".repeat(c.rating)}</span>` : ""}${c.note ? ` — <span class="muted">${esc(c.note)}</span>` : ""}</li>`).join("")}</ul>` : ""}
              ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}
            </div>
          </div>`).join("")}
        <div class="actions">
          <button class="btn primary" data-action="download">⬇ ${esc(t("downloadCard"))}</button>
          <button class="btn green" data-action="share">↗ ${esc(t("share"))}</button>
        </div>
      </section>
      <section class="card">
        <h2>🔗 ${esc(t("myLinkTitle"))}</h2>
        <div class="muted small">${esc(t("myLinkText"))}</div>
        <div class="linkbox">
          <input type="text" readonly value="${esc(personalLink())}" id="mylink">
          <button class="btn sm" data-action="copy">${esc(t("copy"))}</button>
        </div>
      </section>`;
  }

  // ---------- события ----------
  app.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    const barEl = el.closest("[data-bar]");
    const barId = barEl?.dataset.bar;

    if (action === "tab") {
      state.tab = el.dataset.tab;
      renderMain();
      if (state.tab === "photos") loadPhotos();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (action === "toggle") {
      state.open = state.open === barId ? null : barId;
      renderMain();
      if (state.open) document.querySelector(`[data-bar="${barId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "star") {
      const d = getDraft(barId);
      const key = el.dataset.key, v = +el.dataset.v;
      if (key === "bar") d.rating = v;
      else { const c = d.cocktails[+key.slice(1)]; c.rating = c.rating === v ? 0 : v; }
      const stars = el.parentElement;
      const val = key === "bar" ? d.rating : d.cocktails[+key.slice(1)].rating;
      stars.querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.v <= val));
    } else if (action === "add-cocktail") {
      getDraft(barId).cocktails.push({ name: "", rating: 0, note: "" });
      renderMain();
      const inputs = document.querySelectorAll(`[data-bar="${barId}"] [data-field="c-name"]`);
      inputs[inputs.length - 1]?.focus();
    } else if (action === "rm-cocktail") {
      getDraft(barId).cocktails.splice(+el.dataset.i, 1);
      renderMain();
    } else if (action === "save") {
      await saveBar(barId, el);
    } else if (action === "copy") {
      copyText(personalLink());
    } else if (action === "download") {
      const canvas = await makeCard();
      canvas.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "cocktails-with-the-local-" + state.tour.code + ".png";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      }, "image/png");
    } else if (action === "share") {
      await share();
    } else if (action === "view") {
      openLightbox(el.dataset.id);
    }
  });

  app.addEventListener("input", (e) => {
    const el = e.target;
    const f = el.dataset.field;
    if (!f) return;
    const d = getDraft(el.closest("[data-bar]").dataset.bar);
    if (f === "comment") d.comment = el.value;
    else if (f === "c-name") d.cocktails[+el.dataset.i].name = el.value;
    else if (f === "c-note") d.cocktails[+el.dataset.i].note = el.value;
  });

  async function saveBar(barId, btn) {
    const d = getDraft(barId);
    const errEl = btn.parentElement.querySelector("[data-err]");
    if (!d.rating) { errEl.textContent = t("ratingRequired"); return; }
    const cocktails = d.cocktails
      .map((c) => ({ name: c.name.trim(), rating: c.rating || 0, note: (c.note || "").trim() }))
      .filter((c) => c.name);
    const review = {
      tour_id: state.tour.id, bar_id: barId, guest_id: state.guest.id, guest_name: state.guest.name,
      rating: d.rating, comment: d.comment.trim(), cocktails
    };
    btn.disabled = true;
    btn.textContent = t("saving");
    try {
      await DB.saveReview(review);
      state.reviews[barId] = review;
      delete state.drafts[barId];
      // открываем следующий неоценённый бар
      const next = state.tour.bars.find((b) => !state.reviews[b.id]);
      state.open = next ? next.id : null;
      renderMain();
      const moreSecret = state.tour.bars.length < state.tour.total;
      toast(!next && moreSecret ? t("waitNext") : t("saved"));
      if (!next && !moreSecret) { state.tab = "my"; renderMain(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = t("save");
      errEl.textContent = t("saveError");
    }
  }

  function copyText(text) {
    const done = () => toast(t("copied"));
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      const inp = $("#mylink");
      if (inp) { inp.select(); try { document.execCommand("copy"); done(); } catch (e) {} }
    }
  }

  async function share() {
    const url = personalLink();
    try {
      const canvas = await makeCard();
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      const file = new File([blob], "cocktails-with-the-local.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Cocktails with the Local", text: t("shareText") + "\n" + url });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "Cocktails with the Local", text: t("shareText"), url });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
    copyText(url);
  }

  // ---------- открытка ----------
  function fit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    return text + "…";
  }

  function wrap(ctx, text, maxW, maxLines) {
    const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (ctx.measureText(test).width <= maxW || !cur) cur = test;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = fit(ctx, lines[maxLines - 1] + "…", maxW);
    }
    return lines.map((l) => fit(ctx, l, maxW));
  }

  async function makeCard() {
    try { await document.fonts.ready; } catch (e) {}
    const W = 1080, P = 80;
    const PINK = "#ff5fa2", GREEN = "#3ddc97", TEXT = "#fff4f8", MUTED = "#a9cbbb", SOFT = "#ffd3e6";
    const rated = state.tour.bars.map((b, i) => ({ b, i, r: state.reviews[b.id] })).filter((x) => x.r);
    const fav = favorite();
    const nCocktails = rated.reduce((s, x) => s + (x.r.cocktails || []).length, 0);
    const ig = (window.APP_CONFIG || {}).INSTAGRAM;

    // Рисуем дважды: сначала только считаем высоту, потом рисуем на холсте нужного размера
    function layout(ctx, H, draw) {
      const txt = (s, x, y) => { if (draw) ctx.fillText(s, x, y); };
      if (draw) {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, "#0c271d"); g.addColorStop(1, "#164330");
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.22; ctx.fillStyle = PINK;
        ctx.beginPath(); ctx.arc(W - 40, 60, 300, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.14; ctx.fillStyle = GREEN;
        ctx.beginPath(); ctx.arc(40, H - 40, 280, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 3;
        ctx.strokeRect(36, 36, W - 72, H - 72);
      }
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

      // заголовок
      ctx.fillStyle = TEXT; ctx.font = "700 62px Unbounded, sans-serif";
      txt("Cocktails with", P, 170);
      ctx.fillStyle = PINK; txt("the Local", P, 245);
      ctx.fillStyle = MUTED; ctx.font = "600 34px Manrope, sans-serif";
      txt(fit(ctx, t("tagline") + " · " + t("cardNight"), W - 2 * P), P, 305);
      ctx.fillStyle = TEXT; ctx.font = "800 40px Manrope, sans-serif";
      txt(fit(ctx, t("cardOf", { name: state.guest.name, date: fmtDate(state.tour.date) }), W - 2 * P), P, 375);
      ctx.fillStyle = GREEN; ctx.font = "700 30px Manrope, sans-serif";
      txt(t("cardStats", { b: rated.length, c: nCocktails }), P, 425);

      // разделитель
      let y = 470;
      if (draw) { ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(P, y - 10, W - 2 * P, 2); }
      y += 60;

      const textX = P + 80, textW = W - P - textX;
      for (const { b, i, r } of rated) {
        // номер и звёзды
        if (draw) {
          ctx.fillStyle = PINK;
          ctx.beginPath(); ctx.arc(P + 26, y - 14, 28, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "700 26px Unbounded, sans-serif"; ctx.textAlign = "center";
          ctx.fillText(String(i + 1), P + 26, y - 4); ctx.textAlign = "left";
          ctx.fillStyle = PINK; ctx.font = "700 38px sans-serif"; ctx.textAlign = "right";
          ctx.fillText(starsText(r.rating), W - P, y); ctx.textAlign = "left";
        }
        // название бара (до 2 строк)
        ctx.fillStyle = TEXT; ctx.font = "800 40px Manrope, sans-serif";
        const nameLines = wrap(ctx, b.name, textW - 230, 2);
        nameLines.forEach((l, k) => txt(l, textX, y + k * 48));
        y += nameLines.length * 48 + 6;

        // все коктейли
        for (const cl of r.cocktails || []) {
          ctx.font = "700 32px Manrope, sans-serif";
          ctx.fillStyle = GREEN; txt("🍸", textX, y);
          ctx.fillStyle = TEXT;
          const stars = cl.rating ? "★".repeat(cl.rating) : "";
          ctx.font = "700 32px Manrope, sans-serif";
          const nm = fit(ctx, cl.name, textW - 60 - (stars ? 190 : 0));
          txt(nm, textX + 52, y);
          if (stars) {
            const w = ctx.measureText(nm).width;
            ctx.fillStyle = PINK; ctx.font = "700 28px sans-serif";
            txt(stars, textX + 52 + w + 14, y - 2);
          }
          y += 42;
          if (cl.note) {
            ctx.fillStyle = MUTED; ctx.font = "italic 500 28px Manrope, sans-serif";
            const nl = wrap(ctx, cl.note, textW - 52, 3);
            nl.forEach((l, k) => txt(l, textX + 52, y + k * 36));
            y += nl.length * 36 + 4;
          }
          y += 8;
        }
        // отзыв о баре
        if (r.comment) {
          y += 6;
          ctx.fillStyle = SOFT; ctx.font = "500 30px Manrope, sans-serif";
          const cl = wrap(ctx, "«" + r.comment + "»", textW, 6);
          cl.forEach((l, k) => txt(l, textX, y + k * 40));
          y += cl.length * 40;
        }
        y += 56;
      }

      // коктейль вечера
      if (fav) {
        const bx = P, by = y, bw = W - 2 * P, bh = 150;
        if (draw) {
          ctx.fillStyle = "rgba(255,95,162,0.18)";
          ctx.strokeStyle = "rgba(255,95,162,0.6)"; ctx.lineWidth = 3;
          roundRect(ctx, bx, by, bw, bh, 26); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = SOFT; ctx.font = "700 26px Manrope, sans-serif";
        txt(t("favorite").toUpperCase() + " · " + fit(ctx, fav.bar, 420), bx + 36, by + 52);
        ctx.fillStyle = TEXT; ctx.font = "700 46px Unbounded, sans-serif";
        txt(fit(ctx, "🍸 " + fav.name, bw - 72), bx + 36, by + 115);
        y += bh + 40;
      }
      y = Math.max(y + 40, H - 82); // подпись прижата к низу открытки
      ctx.fillStyle = MUTED; ctx.font = "700 30px Manrope, sans-serif"; ctx.textAlign = "center";
      txt(t("thanks") + (ig ? "  @" + ig : ""), W / 2, y);
      ctx.textAlign = "left";
      return y + 90;
    }

    const probe = document.createElement("canvas").getContext("2d");
    const H = Math.max(1350, Math.ceil(layout(probe, 0, false)));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    layout(c.getContext("2d"), H, true);
    return c;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- фотоальбом ----------
  function photosTab() {
    const list = state.photos;
    return `
      <section class="card">
        <div class="muted small">${esc(t("albumHint"))}</div>
        <label class="btn primary block" style="margin-top:12px" ${state.uploading ? "disabled" : ""}>📸 ${esc(t("addPhotos"))}
          <input type="file" id="photoInput" accept="image/*" multiple hidden ${state.uploading ? "disabled" : ""}>
        </label>
        <div class="small muted" id="upl" style="text-align:center;margin-top:8px"></div>
      </section>
      ${!state.photosLoaded ? `<div class="loading">📸 …</div>`
        : list.length ? `<div class="album">${list.map((p) => `
          <button type="button" class="ph" data-action="view" data-id="${p.id}">
            <img src="${esc(p.url)}" alt="" loading="lazy">
            <span class="ph-name">${esc(p.author_name)}</span>
          </button>`).join("")}</div>`
        : `<section class="card hero"><div class="emoji-big">📷</div><p>${esc(t("photosEmpty"))}</p></section>`}`;
  }

  async function loadPhotos() {
    try {
      state.photos = await DB.getPhotos(state.tour.id, state.guest.id);
      state.photosLoaded = true;
    } catch (e) { console.error(e); state.photosLoaded = true; }
    if (state.tab === "photos" && state.view === renderMain && !state.uploading) renderMain();
  }

  app.addEventListener("change", async (e) => {
    if (e.target.id !== "photoInput" || !e.target.files.length) return;
    const files = [...e.target.files].slice(0, 20);
    state.uploading = true;
    renderMain();
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      const upl = $("#upl");
      if (upl) upl.textContent = t("uploading", { a: i + 1, b: files.length });
      try {
        const blob = await resizeImage(files[i], DB.mode === "demo" ? 800 : 1600);
        await DB.addPhoto(state.tour.id, state.guest.id, state.guest.name, blob);
        ok++;
      } catch (err) { console.error(err); toast(t("uploadError"), true); break; }
    }
    state.uploading = false;
    await loadPhotos();
    renderMain();
    if (ok) toast(t("photosAdded"));
  });

  function openLightbox(id) {
    const p = state.photos.find((x) => x.id === id);
    if (!p) return;
    const box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = `
      <div class="lb-inner">
        <img src="${esc(p.url)}" alt="">
        <div class="lb-bar">
          <span>📸 ${esc(p.author_name)}</span>
          <span class="row">
            <a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener" download>${esc(t("openPhoto"))}</a>
            ${p.mine ? `<button type="button" class="btn sm danger" data-lb="delete">${esc(t("deletePhoto"))}</button>` : ""}
            <button type="button" class="btn sm" data-lb="close">✕ ${esc(t("close"))}</button>
          </span>
        </div>
      </div>`;
    const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    box.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-lb]")?.dataset.lb;
      if (e.target === box || a === "close") return close();
      if (a === "delete" && confirm(t("deleteConfirm"))) {
        try { await DB.deleteMyPhoto(p.id, state.guest.id); } catch (err) { console.error(err); }
        close();
        loadPhotos();
      }
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(box);
  }

  // ---------- новые бары: гид открывает их по ходу вечера ----------
  let pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(checkForNewBars, 20000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForNewBars(); });
  }
  async function checkForNewBars() {
    if (document.hidden || !state.tour || !state.guest?.name || state.view !== renderMain) return;
    if (state.tab === "photos" && !state.uploading && !document.querySelector(".lightbox")) loadPhotos();
    // не перерисовываем, пока гость печатает — проверим в следующий раз
    const ae = document.activeElement;
    if (ae && app.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName)) return;
    let fresh;
    try { fresh = await DB.getTour(state.tour.code); } catch (e) { return; }
    if (!fresh) return;
    if (fresh.total == null) fresh.total = fresh.bars.length;
    const before = state.tour.bars.length;
    if (fresh.bars.length === before && fresh.total === state.tour.total) return;
    const added = fresh.bars.length > before;
    state.tour = fresh;
    if (added) {
      const next = fresh.bars.find((b) => !state.reviews[b.id]);
      if (next && !state.open) state.open = next.id;
      state.tab = "bars";
    }
    renderMain();
    if (added) {
      toast(t("newBar"));
      if (navigator.vibrate) navigator.vibrate(150);
    }
  }

  // ---------- загрузка ----------
  async function loadTour(code) {
    show(() => (app.innerHTML = `<div class="loading">🍸 …</div>`));
    let tour;
    try { tour = await DB.getTour(code); }
    catch (e) { console.error(e); return show(() => (app.innerHTML = `<section class="card hero"><p class="err">${esc(t("loadError"))}</p></section>`)); }
    if (!tour) return codeScreen(t("tourNotFound"));
    if (tour.total == null) tour.total = tour.bars.length;
    state.tour = tour;
    startPolling();
    state.reviews = {}; state.drafts = {}; state.open = null;

    const key = "cwl_guest_" + tour.code.toUpperCase();
    let guest = lsGet(key);
    const g = params.get("g");
    if (isUuid(g) && (!guest || guest.id !== g)) guest = { id: g, name: "" };

    if (guest && guest.id) {
      state.guest = guest;
      try {
        const list = await DB.getMyReviews(tour.id, guest.id);
        list.forEach((r) => (state.reviews[r.bar_id] = r));
        if (!guest.name && list[0]) guest.name = list[0].guest_name;
      } catch (e) { console.error(e); }
    }
    if (!state.guest || !state.guest.name) return nameScreen();
    lsSet(key, state.guest);
    state.open = (tour.bars.find((b) => !state.reviews[b.id]) || {}).id || null;
    mainScreen();
  }

  applyLang(getLang());
  const code = (params.get("tour") || "").trim();
  if (code) loadTour(code);
  else codeScreen();
})();
