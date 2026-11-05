// Работа с данными: онлайн-база Supabase или демо-режим (в браузере)
(function () {
  const cfg = window.APP_CONFIG || {};

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  window.uuid = uuid;

  // ---------- Supabase ----------
  function makeSupabase() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const check = ({ data, error }) => {
      if (error) throw error;
      return data;
    };
    return {
      mode: "supabase",
      // гостевые функции
      async getTour(code) {
        return check(await sb.rpc("get_tour", { p_code: code }));
      },
      async getMyReviews(tourId, guestId) {
        return check(await sb.rpc("get_my_reviews", { p_tour: tourId, p_guest: guestId })) || [];
      },
      async saveReview(r) {
        check(await sb.rpc("save_review", {
          p_tour: r.tour_id, p_bar: r.bar_id, p_guest: r.guest_id, p_name: r.guest_name,
          p_rating: r.rating, p_comment: r.comment || "", p_cocktails: r.cocktails || []
        }));
      },
      // функции гида
      async getSession() {
        const { data } = await sb.auth.getSession();
        return data.session;
      },
      async signIn(email, password) {
        check(await sb.auth.signInWithPassword({ email, password }));
      },
      async signOut() { await sb.auth.signOut(); },
      async listBars() {
        return check(await sb.from("bars").select("*").order("name"));
      },
      async saveBar(bar) {
        const row = { name: bar.name, address: bar.address || null, map_url: bar.map_url || null };
        if (bar.id) check(await sb.from("bars").update(row).eq("id", bar.id));
        else check(await sb.from("bars").insert(row));
      },
      async deleteBar(id) {
        check(await sb.from("bars").delete().eq("id", id));
      },
      async listTours() {
        return check(await sb.from("tours").select("*").order("tour_date", { ascending: false }));
      },
      async saveTour(tour) {
        const row = { code: tour.code, tour_date: tour.tour_date, title: tour.title || null, bar_ids: tour.bar_ids };
        if (tour.id) check(await sb.from("tours").update(row).eq("id", tour.id));
        else check(await sb.from("tours").insert(row));
      },
      async deleteTour(id) {
        check(await sb.from("tours").delete().eq("id", id));
      },
      async setRevealed(id, n) {
        check(await sb.from("tours").update({ revealed: n }).eq("id", id));
      },
      // ---- фотоальбом ----
      photoUrl(path) {
        return sb.storage.from("tour-photos").getPublicUrl(path).data.publicUrl;
      },
      async _upload(tourId, blob) {
        const path = tourId + "/" + uuid() + ".jpg";
        const { error } = await sb.storage.from("tour-photos").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
        if (error) throw error;
        return path;
      },
      async getPhotos(tourId, guestId) {
        const rows = check(await sb.rpc("get_photos", { p_tour: tourId, p_guest: guestId })) || [];
        return rows.map((r) => Object.assign(r, { url: this.photoUrl(r.path) }));
      },
      async addPhoto(tourId, guestId, name, blob) {
        const path = await this._upload(tourId, blob);
        check(await sb.rpc("add_photo", { p_tour: tourId, p_guest: guestId, p_name: name, p_path: path }));
      },
      async deleteMyPhoto(id, guestId) {
        check(await sb.rpc("delete_my_photo", { p_id: id, p_guest: guestId }));
      },
      async listPhotos() {
        const rows = check(await sb.from("photos").select("*").order("created_at", { ascending: false }));
        return rows.map((r) => Object.assign(r, { url: this.photoUrl(r.path) }));
      },
      async guideAddPhoto(tourId, blob) {
        const path = await this._upload(tourId, blob);
        check(await sb.from("photos").insert({ tour_id: tourId, author_name: "Гид", path }));
      },
      async guideDeletePhoto(photo) {
        await sb.storage.from("tour-photos").remove([photo.path]);
        check(await sb.from("photos").delete().eq("id", photo.id));
      },
      async listReviews() {
        return check(await sb.from("reviews").select("*").order("created_at", { ascending: false }));
      }
    };
  }

  // ---------- Демо-режим ----------
  function makeLocal() {
    const KEY = "cwl_demo_db";
    let mem = null;
    function seed() {
      const b1 = { id: uuid(), name: "Пример: Бар на крыше", address: "пр. Абая, 1", map_url: "" };
      const b2 = { id: uuid(), name: "Пример: Спикизи", address: "ул. Панфилова, 2", map_url: "" };
      const b3 = { id: uuid(), name: "Пример: Винный бар", address: "ул. Кабанбай батыра, 3", map_url: "" };
      return {
        bars: [b1, b2, b3],
        tours: [{ id: uuid(), code: "DEMO", tour_date: new Date().toISOString().slice(0, 10), title: "Демо-экскурсия", bar_ids: [b1.id, b2.id, b3.id] }],
        reviews: []
      };
    }
    function load() {
      // читаем заново каждый раз, чтобы вкладки гида и гостя видели изменения друг друга
      try { mem = JSON.parse(localStorage.getItem(KEY)) || mem; } catch (e) {}
      if (!mem) { mem = seed(); persist(); }
      return mem;
    }
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {}
    }
    const clone = (x) => JSON.parse(JSON.stringify(x));
    return {
      mode: "demo",
      async getTour(code) {
        const d = load();
        const tour = d.tours.find((x) => x.code.toUpperCase() === String(code).trim().toUpperCase());
        if (!tour) return null;
        const revealed = tour.revealed ?? 1;
        return {
          id: tour.id, code: tour.code, date: tour.tour_date, title: tour.title,
          total: tour.bar_ids.length,
          bars: tour.bar_ids.slice(0, revealed).map((id) => d.bars.find((b) => b.id === id)).filter(Boolean).map((b) => {
            const rs = d.reviews.filter((r) => r.bar_id === b.id);
            const avg = rs.length ? Math.round((rs.reduce((s, r) => s + r.rating, 0) / rs.length) * 10) / 10 : null;
            return Object.assign(clone(b), { avg, count: rs.length });
          })
        };
      },
      async getMyReviews(tourId, guestId) {
        return clone(load().reviews.filter((r) => r.tour_id === tourId && r.guest_id === guestId));
      },
      async saveReview(r) {
        const d = load();
        const tour = d.tours.find((x) => x.id === r.tour_id);
        const pos = tour ? tour.bar_ids.indexOf(r.bar_id) : -1;
        if (pos < 0 || pos >= (tour.revealed ?? 1)) throw new Error("bar is not open in this tour");
        const i = d.reviews.findIndex((x) => x.tour_id === r.tour_id && x.bar_id === r.bar_id && x.guest_id === r.guest_id);
        const now = new Date().toISOString();
        if (i >= 0) d.reviews[i] = Object.assign(d.reviews[i], clone(r), { updated_at: now });
        else d.reviews.push(Object.assign({ id: uuid(), created_at: now, updated_at: now }, clone(r)));
        persist();
      },
      async getSession() { return { demo: true }; },
      async signIn() {},
      async signOut() {},
      async listBars() {
        return clone(load().bars).sort((a, b) => a.name.localeCompare(b.name));
      },
      async saveBar(bar) {
        const d = load();
        if (bar.id) Object.assign(d.bars.find((b) => b.id === bar.id), bar);
        else d.bars.push(Object.assign({ id: uuid() }, bar));
        persist();
      },
      async deleteBar(id) {
        const d = load();
        if (d.reviews.some((r) => r.bar_id === id)) throw new Error("У этого бара уже есть отзывы — его нельзя удалить.");
        d.bars = d.bars.filter((b) => b.id !== id);
        d.tours.forEach((t) => (t.bar_ids = t.bar_ids.filter((x) => x !== id)));
        persist();
      },
      async listTours() {
        return clone(load().tours).sort((a, b) => b.tour_date.localeCompare(a.tour_date));
      },
      async saveTour(tour) {
        const d = load();
        const dup = d.tours.find((x) => x.code.toUpperCase() === tour.code.toUpperCase() && x.id !== tour.id);
        if (dup) throw new Error("Такой код уже занят другой экскурсией.");
        if (tour.id) Object.assign(d.tours.find((x) => x.id === tour.id), tour);
        else d.tours.push(Object.assign({ id: uuid(), revealed: 1 }, tour));
        persist();
      },
      async setRevealed(id, n) {
        const d = load();
        d.tours.find((x) => x.id === id).revealed = n;
        persist();
      },
      // ---- фотоальбом (в демо-режиме фото хранятся в браузере) ----
      _toDataUrl(blob) {
        return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      },
      async getPhotos(tourId, guestId) {
        return (load().photos || []).filter((p) => p.tour_id === tourId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((p) => ({ id: p.id, author_name: p.author_name, url: p.url, created_at: p.created_at, mine: p.guest_id === guestId }));
      },
      async addPhoto(tourId, guestId, name, blob) {
        const d = load();
        (d.photos = d.photos || []).push({ id: uuid(), tour_id: tourId, guest_id: guestId, author_name: name, url: await this._toDataUrl(blob), created_at: new Date().toISOString() });
        mem = d; persist();
      },
      async deleteMyPhoto(id, guestId) {
        const d = load();
        d.photos = (d.photos || []).filter((p) => !(p.id === id && p.guest_id === guestId));
        persist();
      },
      async listPhotos() {
        return clone(load().photos || []).sort((a, b) => b.created_at.localeCompare(a.created_at));
      },
      async guideAddPhoto(tourId, blob) {
        const d = load();
        (d.photos = d.photos || []).push({ id: uuid(), tour_id: tourId, guest_id: null, author_name: "Гид", url: await this._toDataUrl(blob), created_at: new Date().toISOString() });
        mem = d; persist();
      },
      async guideDeletePhoto(photo) {
        const d = load();
        d.photos = (d.photos || []).filter((p) => p.id !== photo.id);
        persist();
      },
      async deleteTour(id) {
        const d = load();
        d.tours = d.tours.filter((x) => x.id !== id);
        d.reviews = d.reviews.filter((r) => r.tour_id !== id);
        d.photos = (d.photos || []).filter((p) => p.tour_id !== id);
        persist();
      },
      async listReviews() {
        return clone(load().reviews).sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
    };
  }

  // Уменьшаем фото перед загрузкой (быстрее и экономнее для мобильного интернета)
  window.resizeImage = async function (file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
    } finally { URL.revokeObjectURL(url); }
  };

  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY;
  if (configured && !window.supabase) {
    // библиотека не загрузилась (нет интернета) — не уходим тихо в демо-режим
    const fail = () => Promise.reject(new Error("Supabase library failed to load"));
    window.DB = new Proxy({ mode: "supabase" }, { get: (o, k) => (k in o ? o[k] : fail) });
  } else {
    window.DB = configured ? makeSupabase() : makeLocal();
  }
})();
