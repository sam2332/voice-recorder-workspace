(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // src/core/dom.ts
  var $, audio, PALETTE, RATES, ICONS;
  var init_dom = __esm({
    "src/core/dom.ts"() {
      $ = (id) => document.getElementById(id);
      audio = $("audio");
      PALETTE = ["#3b6fe0", "#d9534f", "#2a9d6f", "#c97b18", "#8e5bd6", "#d6488f", "#1f9bb3", "#7a8a1f", "#a0522d", "#5865a8"];
      RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];
      ICONS = {
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        spin: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
        alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
        play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/>',
        pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
      };
    }
  });

  // src/core/state.ts
  var state;
  var init_state = __esm({
    "src/core/state.ts"() {
      state = {
        server: false,
        library: [],
        date: null,
        data: null,
        segments: [],
        sources: [],
        renames: {},
        hidden: /* @__PURE__ */ new Set(),
        colors: {},
        activeIdx: -1,
        activeSrc: -1,
        rawIdx: -1,
        matches: [],
        matchIdx: -1,
        duration: 0,
        userScrolledAt: 0,
        openToken: 0,
        pollTimer: null
      };
    }
  });

  // src/util/format.ts
  var fmt, fmtDur, toDate, longDate, shortDate, monthName, clockFmt, clock, plural, initials, fromName, fmtBytes, isoDay;
  var init_format = __esm({
    "src/util/format.ts"() {
      fmt = (s) => {
        if (!isFinite(s)) s = 0;
        s = Math.max(0, Math.floor(s));
        const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
        return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
      };
      fmtDur = (s) => {
        if (!s || !isFinite(s)) return "\u2013";
        if (s < 60) return `${Math.round(s)}s`;
        const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60);
        return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
      };
      toDate = (d) => /* @__PURE__ */ new Date(d + "T00:00:00");
      longDate = (d) => isNaN(+toDate(d)) ? d : toDate(d).toLocaleDateString(void 0, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      shortDate = (d) => isNaN(+toDate(d)) ? d : toDate(d).toLocaleDateString(void 0, { weekday: "short", month: "short", day: "numeric" });
      monthName = (d) => isNaN(+toDate(d)) ? "" : toDate(d).toLocaleDateString(void 0, { month: "long", year: "numeric" });
      clockFmt = new Intl.DateTimeFormat(void 0, { hour: "numeric", minute: "2-digit" });
      clock = (hms, plus = 0) => {
        if (!hms) return null;
        const [h, m, s] = hms.split(":").map(Number);
        return clockFmt.format(new Date(2e3, 0, 1, h, m, s + Math.floor(plus)));
      };
      plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
      initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => /^\d+$/.test(w) ? w : w[0]).join("").slice(0, 2).toUpperCase();
      fromName = (name) => {
        const m = /^V\d{4}-\d{2}-\d{2}-(\d{2})-(\d{2})-(\d{2})/i.exec(name || "");
        return m ? `${m[1]}:${m[2]}:${m[3]}` : null;
      };
      fmtBytes = (b) => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
      isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  });

  // src/day/helpers.ts
  function srcIndexAt(t) {
    if (!sourcesTimed()) return -1;
    let i = -1;
    for (let k = 0; k < state.sources.length; k++) if (state.sources[k].start <= t + 0.01) i = k;
    return i;
  }
  function clockAt(t) {
    const i = srcIndexAt(t);
    return i < 0 ? null : clock(state.sources[i].recorded_at, t - state.sources[i].start);
  }
  var displayName, libItem, isReady, sourcesTimed;
  var init_helpers = __esm({
    "src/day/helpers.ts"() {
      init_state();
      init_format();
      displayName = (spk) => state.renames[spk] || String(spk).replace(/_/g, " ");
      libItem = (date) => state.library.find((d) => d.date === date);
      isReady = () => state.data && state.data.status !== "pending";
      sourcesTimed = () => state.sources.length && state.sources.every((s) => typeof s.start === "number");
    }
  });

  // src/drawers.ts
  function openDrawer(id) {
    const d = $(id), open = !d.classList.contains("open");
    closeDrawers();
    if (open) {
      d.classList.add("open");
      $("scrim").classList.remove("hidden");
    }
  }
  function closeDrawers() {
    ["library", "details"].forEach((id) => $(id).classList.remove("open"));
    $("scrim").classList.add("hidden");
  }
  var init_drawers = __esm({
    "src/drawers.ts"() {
      init_dom();
    }
  });

  // src/util/elements.ts
  var el, svg;
  var init_elements = __esm({
    "src/util/elements.ts"() {
      el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = String(text);
        return n;
      };
      svg = (paths, cls) => {
        const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        s.setAttribute("viewBox", "0 0 24 24");
        s.setAttribute("fill", "none");
        s.setAttribute("stroke", "currentColor");
        s.setAttribute("stroke-width", "2");
        s.setAttribute("stroke-linecap", "round");
        s.setAttribute("stroke-linejoin", "round");
        if (cls) s.setAttribute("class", cls);
        s.innerHTML = paths;
        return s;
      };
    }
  });

  // src/home/widgets.ts
  function card(icon, title, cls = "") {
    const c = el("section", "card " + cls);
    const h = el("h3");
    h.append(svg(HOME_ICONS[icon]), el("span", null, title));
    c.append(h);
    return c;
  }
  function btn(label, cls, onclick) {
    const b = el("button", "btn " + cls, label);
    b.onclick = onclick;
    return b;
  }
  function progressBar(frac, left, right) {
    const p = el("div", "progress");
    const bar = el("div", "bar" + (frac ? "" : " indeterminate"));
    const fill = el("i");
    fill.style.width = `${(frac || 0) * 100}%`;
    bar.append(fill);
    const lbl = el("div", "lbl");
    lbl.append(el("span", null, left), el("span", null, right || ""));
    p.append(bar, lbl);
    return p;
  }
  function checksList() {
    const ul = el("ul", "checks");
    const names = { hf: "Speaker detection models (Hugging Face)", ffmpeg: "Audio tools (ffmpeg)", gpu: "Graphics card", record_dir: "Recordings folder" };
    for (const [k, label] of Object.entries(names)) {
      const c = state.checks?.[k];
      if (!c) continue;
      const li = el("li");
      const icon = el("span", c.ok ? "ok" : "bad");
      icon.append(svg(c.ok ? HOME_ICONS.check : HOME_ICONS.alert));
      icon.firstChild.style.width = "18px";
      const txt = el("div");
      txt.append(el("div", null, label), el("div", "d", c.detail));
      li.append(icon, txt);
      ul.append(li);
    }
    return ul;
  }
  function cachedForm(kind, onSave, label) {
    const key = JSON.stringify(state.settings);
    state.forms = state.forms || {};
    if (state.forms[kind]?.key !== key) state.forms[kind] = { key, node: settingsForm(onSave, label) };
    return state.forms[kind].node;
  }
  var HOME_ICONS;
  var init_widgets = __esm({
    "src/home/widgets.ts"() {
      init_state();
      init_settings();
      init_elements();
      HOME_ICONS = {
        mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>',
        usb: '<path d="M10 7V3h4v4"/><rect x="7" y="7" width="10" height="14" rx="2"/><path d="M10 11h4"/>',
        wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>',
        gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
        cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>'
      };
    }
  });

  // src/day/stats.ts
  function renderStats() {
    const lib = libItem(state.date) || {};
    const words = state.segments.reduce((n, s) => n + (s.noise ? 0 : (s.text.match(/\S+/g) || []).length), 0);
    const recs = state.sources.length || lib.recordings || 0;
    const unit = isReady() && state.sources.some((s) => s.file) ? "segment" : "recording";
    const dur = state.duration || lib.duration || state.sources.reduce((n, s) => n + (s.duration || 0), 0);
    const items = isReady() ? [[fmtDur(dur), "Length"], [words.toLocaleString(), "Words"], [recs, plural(recs, unit[0].toUpperCase() + unit.slice(1)).replace(/^\d+ /, "")], [speakerCount(), "Speakers"]] : [[fmtDur(dur), "Audio"], [recs, plural(recs, "Recording").replace(/^\d+ /, "")]];
    $("stats").replaceChildren(...items.map(([v, l]) => {
      const s = el("div", "stat");
      s.append(el("b", null, String(v)), el("span", null, l));
      return s;
    }));
    const bits = [fmtDur(dur)];
    if (recs) bits.push(plural(recs, unit));
    if (isReady()) bits.push(plural(speakerCount(), "speaker"));
    else bits.push("not transcribed yet");
    $("subtitle").textContent = bits.join(" \xB7 ");
  }
  function renderBanner() {
    const lib = libItem(state.date);
    const n = lib?.new_recordings || 0;
    const job = lib?.job;
    const busy = job && job.status !== "failed";
    $("banner").classList.toggle("hidden", !n && !job);
    if (!n && !job) return;
    const pct = job?.status === "processing" && job.progress ? ` ${Math.round(job.progress * 100)}%` : "";
    $("banner-text").textContent = busy ? job.status === "queued" ? "Waiting to re-transcribe this day\u2026" : `Re-transcribing this day\u2026 ${job.label}${pct}. The transcript below updates when it's done.` : job?.status === "failed" ? `Re-transcribing failed: ${job.error}` : `${plural(n, "new recording")} from this day ${n === 1 ? "isn't" : "aren't"} in the transcript yet.` + (lib?.edited ? " You\u2019ve edited this day, so it won\u2019t re-transcribe by itself." : "");
    $("banner-btn").classList.toggle("hidden", !!busy);
    $("banner-btn").textContent = job?.status === "failed" ? "Try again" : "Re-transcribe";
  }
  var speakerCount;
  var init_stats = __esm({
    "src/day/stats.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_elements();
      init_format();
      speakerCount = () => new Set(state.segments.filter((s) => !s.noise).map((s) => s.speaker)).size;
    }
  });

  // src/player/sync.ts
  function findIdx(t) {
    const a = state.segments;
    let lo = 0, hi = a.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (a[mid].start <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans >= 0 && t <= a[ans].end + 0.75 ? ans : -1;
  }
  function syncActive(force) {
    if (!isReady()) return;
    const idx = findIdx(audio.currentTime);
    if (idx === state.activeIdx && !force) return;
    document.querySelectorAll(".cue.active").forEach((n) => n.classList.remove("active"));
    state.activeIdx = idx;
    updateNow();
    if (idx < 0) {
      updateJump(null);
      return;
    }
    const node = document.querySelector(`.cue[data-i="${idx}"]`);
    if (!node) return;
    node.classList.add("active");
    const following = $("follow").checked && Date.now() - state.userScrolledAt > 4e3;
    if (following && !audio.paused) node.scrollIntoView({ behavior: "smooth", block: "center" });
    updateJump(node);
  }
  function updateNow() {
    let text = "";
    if (isReady()) {
      const seg = state.segments[state.activeIdx];
      const c = clockAt(audio.currentTime);
      text = [c, seg && !audio.paused ? `${displayName(seg.speaker)} speaking` : ""].filter(Boolean).join(" \xB7 ");
    } else if (state.rawIdx >= 0) {
      const s = state.sources[state.rawIdx];
      text = `Raw recording ${state.rawIdx + 1}` + (s.recorded_at ? ` \xB7 ${clock(s.recorded_at, audio.currentTime)}` : "");
    }
    $("now").textContent = text;
  }
  function updateJump(node = document.querySelector(".cue.active")) {
    const box = $("transcript").getBoundingClientRect();
    let off = false;
    if (node && !audio.paused && isReady()) {
      const r = node.getBoundingClientRect();
      off = r.bottom < box.top || r.top > box.bottom;
    }
    $("jump").classList.toggle("hidden", !off);
  }
  function updateProgress() {
    const dur = (isReady() ? state.duration : audio.duration) || 0, t = audio.currentTime || 0;
    const pct = dur ? Math.min(100, t / dur * 100) : 0;
    $("played").style.width = pct + "%";
    $("knob").style.left = pct + "%";
    $("time").textContent = `${fmt(t)} / ${fmt(dur)}`;
    $("timeline").setAttribute("aria-valuenow", String(Math.round(t)));
    $("timeline").setAttribute("aria-valuetext", fmt(t));
  }
  function updatePlayIcon() {
    const playing = !audio.paused;
    $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
    $("play-icon").innerHTML = playing ? ICONS.pause : ICONS.play;
    if (!isReady() && state.date) renderPending();
  }
  var init_sync = __esm({
    "src/player/sync.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_pending();
      init_format();
    }
  });

  // src/player/timeline.ts
  function renderTimeline() {
    const dur = state.duration || 1;
    const frag = document.createDocumentFragment();
    if (isReady()) {
      for (const s of state.segments) {
        if (s.noise) continue;
        const d = el("div", "seg");
        d.style.left = s.start / dur * 100 + "%";
        d.style.width = Math.max(0.1, (s.end - s.start) / dur * 100) + "%";
        d.style.background = state.colors[s.speaker];
        frag.append(d);
      }
    }
    $("segs").replaceChildren(frag);
    const ticks = document.createDocumentFragment();
    if (isReady() && sourcesTimed()) {
      state.sources.slice(1).forEach((s) => {
        const t = el("div", "tick");
        t.style.left = s.start / dur * 100 + "%";
        ticks.append(t);
      });
    }
    $("ticks").replaceChildren(ticks);
    $("timeline").setAttribute("aria-valuemax", String(Math.round(dur)));
  }
  function init() {
    tl.addEventListener("pointerdown", (e) => {
      if (!tlDur()) return;
      dragging = true;
      tl.setPointerCapture(e.pointerId);
      seek(tAt(e.clientX));
    });
    tl.addEventListener("pointermove", (e) => {
      if (!tlDur()) return;
      const t = tAt(e.clientX), r = tl.getBoundingClientRect();
      let label = fmt(t);
      if (isReady()) {
        const seg = state.segments[findIdx(t)], c = clockAt(t);
        label = [c || fmt(t), seg ? displayName(seg.speaker) : ""].filter(Boolean).join(" \xB7 ");
      }
      tip.textContent = label;
      tip.style.left = Math.max(50, Math.min(r.width - 50, e.clientX - r.left)) + "px";
      tip.classList.remove("hidden");
      if (dragging) seek(t);
    });
    tl.addEventListener("pointerup", () => dragging = false);
    tl.addEventListener("pointerleave", () => {
      if (!dragging) tip.classList.add("hidden");
    });
    tl.addEventListener("keydown", (e) => {
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        seek(audio.currentTime + (e.key === "ArrowLeft" ? -5 : 5));
      }
    });
  }
  var tl, tip, tlDur, tAt, dragging;
  var init_timeline = __esm({
    "src/player/timeline.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_audio();
      init_sync();
      init_elements();
      init_format();
      tl = $("timeline");
      tip = $("tip");
      tlDur = () => (isReady() ? state.duration : audio.duration) || 0;
      tAt = (x) => {
        const r = tl.getBoundingClientRect();
        return Math.max(0, Math.min(1, (x - r.left) / r.width)) * tlDur();
      };
      dragging = false;
    }
  });

  // src/util/store.ts
  var store;
  var init_store = __esm({
    "src/util/store.ts"() {
      store = {
        get(k, d) {
          try {
            const v = localStorage.getItem("recplay:" + k);
            return v == null ? d : JSON.parse(v);
          } catch {
            return d;
          }
        },
        set(k, v) {
          try {
            localStorage.setItem("recplay:" + k, JSON.stringify(v));
          } catch {
          }
        }
      };
    }
  });

  // src/util/toast.ts
  var toastTimer, toast;
  var init_toast = __esm({
    "src/util/toast.ts"() {
      init_dom();
      init_elements();
      toast = (msg, opts = {}) => {
        const t = $("toast");
        t.replaceChildren(el("span", null, msg));
        t.classList.toggle("has-action", !!opts.action);
        if (opts.action) {
          const b = el("button", null, opts.action);
          b.onclick = () => {
            t.classList.remove("show");
            opts.onAction();
          };
          t.append(b);
        }
        t.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove("show"), opts.action ? 6e3 : 2800);
      };
    }
  });

  // src/player/audio.ts
  function setAudio(src, { resume = false, quiet = false } = {}) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (src) {
      audio.src = src;
      const date = state.date;
      const pos = resume ? store.get("pos:" + date, 0) : 0;
      audio.addEventListener("loadedmetadata", () => {
        if (date !== state.date) return;
        if (pos > 1 && pos < audio.duration - 2) {
          audio.currentTime = pos;
          toast(`Resumed at ${clockAt(pos) || fmt(pos)}`);
        }
        state.duration = audio.duration || state.duration;
        renderStats();
        renderTimeline();
        updateProgress();
        updateActiveSource();
      }, { once: true });
    } else if (!quiet) {
      toast("The audio file for this day is missing. Showing the transcript only.");
    }
    updatePlayIcon();
  }
  function needAudio() {
    if (audio.src) return false;
    if (!isReady()) {
      if (state.sources.length) playRaw(0);
      return true;
    }
    toast("No audio for this day.");
    return true;
  }
  function togglePlay() {
    if (needAudio()) return;
    audio.paused ? audio.play() : audio.pause();
  }
  function seek(t, play) {
    if (needAudio()) return;
    audio.currentTime = Math.max(0, Math.min(t, (audio.duration || state.duration) - 0.1));
    state.userScrolledAt = 0;
    if (play) audio.play();
    updateProgress();
    syncActive(true);
    updateActiveSource();
  }
  function stepLine(dir) {
    if (!isReady()) return;
    const t = audio.currentTime;
    const visible = state.segments.filter((s) => !state.hidden.has(s.speaker));
    const target = dir > 0 ? visible.find((s) => s.start > t + 0.05) : [...visible].reverse().find((s) => s.start < t - 1);
    if (target) seek(target.start, !audio.paused);
  }
  function setRate(r) {
    audio.playbackRate = r;
    $("rate").textContent = (r % 1 ? r : r.toFixed(0)) + "\xD7";
    store.set("rate", r);
  }
  function savePosition() {
    if (state.date && audio.src && isReady()) store.set("pos:" + state.date, audio.currentTime);
  }
  var init_audio = __esm({
    "src/player/audio.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_recordings();
      init_stats();
      init_sync();
      init_timeline();
      init_format();
      init_store();
      init_toast();
    }
  });

  // src/day/recordings.ts
  function recordingList(raw) {
    const box = el("div");
    state.sources.forEach((s, i) => {
      const active = raw ? state.rawIdx === i : state.activeSrc === i;
      const b = el("button", "rec" + (active ? " active" : ""));
      b.dataset.src = String(i);
      const num = el("span", "num");
      if (raw && active) num.append(svg(audio.paused ? ICONS.play : ICONS.pause));
      else num.textContent = String(i + 1);
      const mid = el("span");
      mid.style.minWidth = "0";
      mid.append(el("div", "when", clock(s.recorded_at) || `Recording ${i + 1}`), el("div", "file", s.name));
      b.append(num, mid, el("span", "len", s.duration ? fmt(s.duration) : ""));
      b.title = raw ? "Play this recording" : "Jump to this recording";
      b.onclick = () => {
        if (raw) playRaw(i);
        else if (typeof s.start === "number") {
          seek(s.start + 0.01, true);
          closeDrawers();
        }
      };
      box.append(b);
    });
    return box;
  }
  function renderRecordings() {
    $("recordings").replaceChildren(recordingList(false));
  }
  function updateActiveSource() {
    if (!isReady()) return;
    const i = srcIndexAt(audio.currentTime);
    if (i === state.activeSrc) return;
    state.activeSrc = i;
    document.querySelectorAll("#recordings .rec").forEach((b) => b.classList.toggle("active", +b.dataset.src === i));
  }
  function playRaw(i) {
    const s = state.sources[i];
    if (!s?.url) {
      toast("That recording file is no longer in the RECORD folder.");
      return;
    }
    if (state.rawIdx === i && audio.src) {
      togglePlay();
      return;
    }
    state.rawIdx = i;
    setAudio(s.url, { quiet: true });
    audio.play().catch(() => {
    });
    renderPending();
  }
  var init_recordings = __esm({
    "src/day/recordings.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_pending();
      init_drawers();
      init_audio();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/util/api.ts
  async function api(path, opts) {
    const r = await fetch(path, opts);
    if (!r.ok) {
      let msg = r.statusText;
      try {
        msg = (await r.json()).detail || msg;
      } catch {
      }
      throw Object.assign(new Error(msg), { status: r.status });
    }
    return r.json();
  }
  var jsonPost;
  var init_api = __esm({
    "src/util/api.ts"() {
      jsonPost = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
  });

  // src/library/queue.ts
  async function transcribe(dates, hint) {
    try {
      for (const d of dates) await api(`/api/days/${d}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hint === void 0 ? {} : { hint })
      });
      toast(dates.length > 1 ? `Queued ${plural(dates.length, "day")}` : "Transcription started");
    } catch (e) {
      toast(e.message);
    }
    refreshLibrary();
  }
  async function cancel(date) {
    try {
      await api(`/api/days/${date}/process`, { method: "DELETE" });
      toast("Removed from queue");
    } catch (e) {
      toast(e.message);
    }
    refreshLibrary();
  }
  var init_queue = __esm({
    "src/library/queue.ts"() {
      init_library();
      init_api();
      init_format();
      init_toast();
    }
  });

  // src/transcribe/levels.ts
  var SENS_LABELS, RUSTLE_OPTS, rustleName, GATE_OFF, dbToLin, levelsPayload;
  var init_levels = __esm({
    "src/transcribe/levels.ts"() {
      SENS_LABELS = { 1: "Lowest", 2: "Low", 3: "Normal", 4: "High", 5: "Highest" };
      RUSTLE_OPTS = [["", "Default"], ["2", "Maximum"], ["1", "Strong"], ["0.5", "Gentle"], ["0", "Off"]];
      rustleName = (v) => v >= 2 ? "Maximum" : v >= 1 ? "Strong" : v > 0 ? "Gentle" : "Off";
      GATE_OFF = -80;
      dbToLin = (d) => Math.pow(10, d / 20);
      levelsPayload = (clips) => Object.fromEntries(clips.map((c) => [c.name, c.edit]));
    }
  });

  // src/transcribe/wave.ts
  function drawWave(clip) {
    const cv = clip.canvas;
    if (!cv || !clip.peaks?.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const col = {
      accent: css.getPropertyValue("--accent"),
      danger: css.getPropertyValue("--danger"),
      muted: css.getPropertyValue("--muted"),
      border: css.getPropertyValue("--border"),
      warn: css.getPropertyValue("--warn")
    };
    const mid = H / 2, half = H / 2 - 2;
    const gain = dbToLin(clip.edit.gain_db);
    const gate = clip.edit.gate_db === null ? 0 : dbToLin(clip.edit.gate_db);
    const n = clip.peaks.length;
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor(x / W * n), i1 = Math.max(i0 + 1, Math.floor((x + 1) / W * n));
      let p = 0, r = 0, rawClip = false;
      for (let i = i0; i < i1 && i < n; i++) {
        p = Math.max(p, clip.peaks[i]);
        r = Math.max(r, clip.rms[i]);
        if (clip.peaks[i] >= 0.98) rawClip = true;
      }
      g.fillStyle = col.border;
      g.fillRect(x, mid - Math.min(p, 1) * half, 1, Math.max(1, Math.min(p, 1) * half * 2));
      const pg = p * gain, rg = r * gain;
      const clipped = gain > 1 && pg >= 1 || rawClip && !clip.edit.declip;
      const repaired = rawClip && clip.edit.declip && !clipped;
      const gated = gate && rg < gate;
      g.fillStyle = clipped ? col.danger : repaired ? col.warn : gated ? col.muted : col.accent;
      g.globalAlpha = gated ? 0.35 : 0.9;
      const h = Math.min(pg, 1) * half;
      g.fillRect(x, mid - h, 1, Math.max(1, h * 2));
      g.globalAlpha = 1;
    }
    g.strokeStyle = col.border;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(0, 2.5);
    g.lineTo(W, 2.5);
    g.moveTo(0, H - 2.5);
    g.lineTo(W, H - 2.5);
    g.stroke();
    if (gate) {
      g.strokeStyle = col.muted;
      g.setLineDash([4, 4]);
      g.beginPath();
      const y = Math.min(gate, 1) * half;
      g.moveTo(0, mid - y);
      g.lineTo(W, mid - y);
      g.moveTo(0, mid + y);
      g.lineTo(W, mid + y);
      g.stroke();
      g.setLineDash([]);
    }
    if (previewing?.clip === clip) {
      const t = previewing.start + (preview.currentTime || 0);
      const xp = t / clip.duration * W;
      g.fillStyle = col.danger;
      g.fillRect(xp, 0, 2, H);
    }
  }
  var init_wave = __esm({
    "src/transcribe/wave.ts"() {
      init_levels();
      init_preview();
    }
  });

  // src/transcribe/preview.ts
  function stopPreview() {
    preview.pause();
    if (previewing) {
      const p = previewing;
      previewing = null;
      drawWave(p.clip);
    }
  }
  function playPreview(clip, t) {
    if (previewing && previewing.clip === clip && Math.abs(previewing.start - t) < 0.5) {
      stopPreview();
      return;
    }
    stopPreview();
    audio.pause();
    const lv = clip.edit;
    const q = new URLSearchParams({ start: t.toFixed(2), gain_db: lv.gain_db, declip: lv.declip });
    if (lv.gate_db !== null) q.set("gate_db", lv.gate_db);
    if (lv.rustle !== null) q.set("rustle", lv.rustle);
    preview.src = `/api/clips/${encodeURIComponent(clip.name)}/preview?${q}`;
    previewing = { clip, start: t };
    preview.play().catch((e) => toast(`Couldn't play the preview: ${e.message}`));
    const tick = () => {
      if (previewing?.clip === clip) {
        drawWave(clip);
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }
  function init2() {
    preview.addEventListener("ended", stopPreview);
  }
  var preview, previewing;
  var init_preview = __esm({
    "src/transcribe/preview.ts"() {
      init_dom();
      init_wave();
      init_toast();
      preview = new Audio();
      previewing = null;
    }
  });

  // src/transcribe/clip-row.ts
  function clipRow(clip, defaultRustle) {
    const lv = clip.levels || {};
    clip.edit = {
      gain_db: lv.gain_db ?? 0,
      sensitivity: lv.sensitivity ?? 3,
      rustle: lv.rustle ?? null,
      gate_db: lv.gate_db ?? null,
      declip: !!lv.declip,
      auto: !!lv.auto
    };
    const row = el("div", "clip" + (clip.issues?.length ? " flagged" : ""));
    const head = el("div", "clip-head");
    head.append(el("b", null, clock(clip.recorded_at) || clip.name), el("span", "muted", fmt(clip.duration)));
    (clip.issues || []).forEach((i) => head.append(el("span", "chip " + (i.code === "clipping" ? "failed" : "pending"), i.label)));
    const autoChip = el("span", "chip new", "Auto-adjusted");
    autoChip.title = "These levels were set automatically from the recording\u2019s measurements";
    autoChip.classList.toggle("hidden", !clip.edit.auto);
    head.append(autoChip);
    const fix = el("button", "btn small", "Auto-adjust");
    fix.type = "button";
    fix.title = clip.auto ? `Measured: ${clip.auto.notes.join(", ")}` : "";
    if (clip.auto) head.append(fix);
    row.append(head);
    (clip.issues || []).forEach((i) => row.append(el("div", "clip-issue", i.detail)));
    const cv = el("canvas", "wave");
    cv.title = "Click to hear 10 seconds from here with these settings (click again to stop)";
    clip.canvas = cv;
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect();
      playPreview(clip, (e.clientX - r.left) / r.width * clip.duration);
    };
    row.append(cv);
    const ctrls = el("div", "clip-ctrls");
    const manual = () => {
      clip.edit.auto = false;
      autoChip.classList.add("hidden");
    };
    const slider = (label, min, max, step, value, fmtv, onchange, tip2) => {
      const w = el("label", "ctl");
      w.title = tip2;
      const top = el("span", "ctl-top");
      const val = el("span", "ctl-val");
      top.append(el("span", null, label), val);
      const inp = el("input");
      inp.type = "range";
      inp.min = min;
      inp.max = max;
      inp.step = step;
      inp.value = value;
      const upd = () => {
        val.textContent = fmtv(+inp.value);
        onchange(+inp.value);
        drawWave(clip);
      };
      inp.oninput = () => {
        upd();
        manual();
      };
      val.textContent = fmtv(+inp.value);
      w.append(top, inp);
      return { w, inp, upd };
    };
    const gain = slider(
      "Volume",
      -12,
      30,
      1,
      clip.edit.gain_db,
      (v) => (v > 0 ? "+" : "") + v + " dB",
      (v) => clip.edit.gain_db = v,
      "Boost or lower this segment before transcription. Red on the waveform means it would clip."
    );
    const sens = slider(
      "Speech sensitivity",
      1,
      5,
      1,
      clip.edit.sensitivity,
      (v) => SENS_LABELS[v],
      (v) => clip.edit.sensitivity = v,
      "Higher picks up quieter or more distant voices, but also more noise."
    );
    const gate = slider(
      "Noise gate",
      GATE_OFF,
      -20,
      1,
      clip.edit.gate_db ?? GATE_OFF,
      (v) => v <= GATE_OFF ? "Off" : v + " dB",
      (v) => clip.edit.gate_db = v <= GATE_OFF ? null : v,
      "Silences everything quieter than the dashed line (hiss, hum, room noise)."
    );
    const rw = el("label", "ctl");
    rw.title = "Turns down the scratchy sound of the mic rubbing on clothes";
    const rtop = el("span", "ctl-top");
    rtop.append(el("span", null, "Rustle cleanup"));
    const rs = el("select");
    RUSTLE_OPTS.forEach(([v, n]) => {
      const o = el("option", null, v === "" ? `Default (${rustleName(defaultRustle)})` : n);
      o.value = v;
      rs.append(o);
    });
    rs.value = clip.edit.rustle === null ? "" : String(+clip.edit.rustle);
    rs.onchange = () => {
      clip.edit.rustle = rs.value === "" ? null : +rs.value;
      manual();
    };
    rw.append(rtop, rs);
    ctrls.append(gain.w, sens.w, gate.w, rw);
    const dc = el("label", "ctl check");
    const dci = el("input");
    dci.type = "checkbox";
    dci.checked = clip.edit.declip;
    dci.onchange = () => {
      clip.edit.declip = dci.checked;
      drawWave(clip);
      manual();
    };
    dc.append(dci, el("span", null, "Repair clipping"));
    dc.title = "Rebuilds peaks that were cut off because the recording was too loud";
    if (clip.issues?.some((i) => i.code === "clipping") || clip.edit.declip) ctrls.append(dc);
    row.append(ctrls);
    clip.autoAdjust = (quiet = false) => {
      const s = clip.auto.levels;
      gain.inp.value = s.gain_db;
      gain.upd();
      sens.inp.value = s.sensitivity;
      sens.upd();
      gate.inp.value = s.gate_db ?? GATE_OFF;
      gate.upd();
      rs.value = s.rustle === null ? "" : String(+s.rustle);
      clip.edit.rustle = s.rustle;
      dci.checked = s.declip;
      clip.edit.declip = s.declip;
      if (s.declip && !dc.isConnected) ctrls.append(dc);
      drawWave(clip);
      clip.edit.auto = true;
      autoChip.classList.remove("hidden");
      if (!quiet) toast(clip.auto.problems.length ? `Adjusted, but ${clip.auto.problems.join("; ")}. Listen before continuing.` : `Auto-adjusted: ${clip.auto.notes.join(", ")}. Click the waveform to listen.`);
    };
    fix.onclick = () => clip.autoAdjust();
    return row;
  }
  var init_clip_row = __esm({
    "src/transcribe/clip-row.ts"() {
      init_levels();
      init_preview();
      init_wave();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/transcribe/dialog.ts
  async function loadClips(date, only) {
    const list = $("clips-list");
    list.replaceChildren(el("div", "note", "Finding the speech in the recordings\u2026"));
    let r;
    try {
      r = await api(`/api/days/${date}/clips`);
    } catch (e) {
      list.replaceChildren(el("div", "error-box", `Couldn't read the recordings: ${e.message}`));
      return [];
    }
    const clips = only ? r.clips.filter((c) => only.includes(c.name)) : r.clips;
    const flagged = clips.filter((c) => c.issues?.length).length;
    $("clips-summary").textContent = `${plural(clips.length, "segment")}` + (flagged ? ` \xB7 ${flagged} need${flagged === 1 ? "s" : ""} attention` : "");
    list.replaceChildren(...clips.map((c) => clipRow(c, r.default_rustle)));
    requestAnimationFrame(() => clips.forEach(drawWave));
    $("auto-all").onclick = () => {
      const auto = clips.filter((c) => c.auto);
      auto.forEach((c) => c.autoAdjust(true));
      const hard = auto.filter((c) => c.auto.problems.length);
      toast(hard.length ? `Adjusted ${plural(auto.length, "segment")}; ${hard.length} still need${hard.length === 1 ? "s" : ""} a listen` : `Adjusted ${plural(auto.length, "segment")}. Click a waveform to listen.`);
    };
    return clips;
  }
  async function askTranscribe(title, date = state.date) {
    const dlg = $("process-dlg");
    dlg.classList.remove("blocked");
    const isCurrent = date === state.date;
    const hint = (isCurrent ? state.data?.speaker_hint : null) || {};
    const n = isCurrent ? Object.keys(state.colors).filter((s) => s !== "Unknown").length : 2;
    $("process-title").textContent = `${title}: ${shortDate(date)}`;
    $("process-lead").textContent = "Stretches of speech are found first, so long silences and steady noise are left out. Check each segment\u2019s levels, then start. Click a waveform to hear it with your settings.";
    const mode = hint.num_speakers ? "exact" : hint.min_speakers ? "min" : "auto";
    document.querySelector(`input[name=count-mode][value=${mode}]`).checked = true;
    $("count-exact").value = String(hint.num_speakers || Math.max(n, 2));
    $("count-min").value = String(hint.min_speakers || Math.max(n + 1, 2));
    const edited = isCurrent ? state.segments.filter((x) => x.edited).length : libItem(date)?.edited || 0;
    $("process-note").replaceChildren(edited ? el("div", "error-box", `You've edited ${plural(edited, "line")} on this day. Re-transcribing replaces the whole transcript, so those edits will be lost. (Removed lines stay removed, and names you've given people are kept.)`) : libItem(date)?.status === "ready" ? "Names you have given people are kept. Takes a few minutes for a long day." : "You can keep browsing while it runs.");
    $("process-actions").replaceChildren(
      Object.assign(el("button", "btn", "Cancel"), { value: "cancel", formNoValidate: true }),
      Object.assign(el("button", "btn primary", edited ? "Replace my edits and start" : "Start"), { value: "ok" })
    );
    dlg.returnValue = "";
    let clips = [];
    dlg.onclose = async () => {
      stopPreview();
      if (dlg.returnValue !== "ok") return;
      const m = document.querySelector("input[name=count-mode]:checked").value;
      const h = m === "exact" ? { num_speakers: +$("count-exact").value } : m === "min" ? { min_speakers: +$("count-min").value } : {};
      try {
        if (clips.length) await api("/api/levels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ levels: levelsPayload(clips), reviewed: true }) });
      } catch (e) {
        toast(`Couldn't save the levels: ${e.message}`);
        return;
      }
      transcribe([date], h);
    };
    dlg.showModal();
    clips = await loadClips(date);
  }
  async function showBlocked(b) {
    const dlg = $("process-dlg");
    state.blockedFor = b.date + "|" + b.clips.join(",");
    dlg.classList.add("blocked");
    $("process-title").textContent = `Check ${b.clips.length > 1 ? "these segments" : "this segment"} before transcribing continues`;
    $("process-lead").textContent = `${shortDate(b.date)}: something looks unusual, so transcription is paused for everything until you choose. Click the waveform to listen.`;
    $("process-note").textContent = "";
    const send = async (levels, action) => {
      try {
        if (levels) await api("/api/levels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ levels, reviewed: true }) });
        await api("/api/blocked", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
        state.blockedFor = null;
        stopPreview();
        dlg.close();
        toast(action === "skip" ? `Skipped ${shortDate(b.date)}` : "Transcription resumed");
        refreshLibrary();
      } catch (e) {
        toast(e.message);
      }
    };
    let clips = [];
    const skip = Object.assign(el("button", "btn", "Skip this day"), { type: "button", onclick: () => send(null, "skip") });
    const asIs = Object.assign(el("button", "btn", "Use as is"), { type: "button", onclick: () => send(Object.fromEntries(clips.map((c) => [c.name, {}])), "continue") });
    const go_ = Object.assign(el("button", "btn primary", "Continue with these levels"), { type: "button", onclick: () => send(levelsPayload(clips), "continue") });
    $("process-actions").replaceChildren(skip, asIs, go_);
    dlg.onclose = null;
    if (!dlg.open) dlg.showModal();
    clips = await loadClips(b.date, b.clips);
  }
  var init_dialog = __esm({
    "src/transcribe/dialog.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_library();
      init_queue();
      init_clip_row();
      init_levels();
      init_preview();
      init_wave();
      init_api();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/day/pending.ts
  function renderPending() {
    const lib = libItem(state.date) || {};
    const job = lib.job;
    const status = job?.status || "pending";
    const card2 = el("div", "pending-card " + status);
    const titles = { pending: "Not transcribed yet", queued: "Waiting in line", processing: "Transcribing\u2026", failed: "Transcription failed" };
    card2.append(svg(status === "failed" ? ICONS.alert : status === "processing" ? ICONS.spin : ICONS.clock, "icon"), el("h2", null, titles[status]));
    const dur = state.sources.reduce((n, s) => n + (s.duration || 0), 0) || lib.duration;
    const bits = [plural(state.sources.length || lib.recordings || 0, "recording"), fmtDur(dur)];
    if (lib.first_time) bits.push(lib.first_time === lib.last_time ? clock(lib.first_time) : `${clock(lib.first_time)} \u2013 ${clock(lib.last_time)}`);
    card2.append(el("p", null, bits.join(" \xB7 ")));
    if (status === "processing") {
      const p = el("div", "progress");
      const bar = el("div", "bar" + (job.progress ? "" : " indeterminate"));
      const fill = el("i");
      fill.style.width = `${job.progress * 100}%`;
      bar.append(fill);
      const lbl = el("div", "lbl");
      lbl.append(el("span", null, job.label + "\u2026"), el("span", null, job.progress ? `${Math.round(job.progress * 100)}%` : ""));
      p.append(bar, lbl);
      card2.append(p, el("p", "note", "You can keep browsing other days. This page updates when it finishes."));
    } else if (status === "queued") {
      card2.append(el("p", "note", `Position ${job.position} in the queue. Days are transcribed one at a time.`));
    } else if (status === "failed") {
      card2.append(el("div", "error-box", job.error));
    }
    const actions = el("div", "actions");
    if (status === "pending" || status === "failed") {
      const b = el("button", "btn primary", status === "failed" ? "Try again" : "Transcribe this day");
      b.onclick = () => askTranscribe(status === "failed" ? "Try again" : "Transcribe");
      actions.append(b);
    } else if (status === "queued") {
      const b = el("button", "btn", "Remove from queue");
      b.onclick = () => cancel(state.date);
      actions.append(b);
    }
    if (actions.children.length) card2.append(actions);
    const inner = $("pending-inner");
    const frag = document.createDocumentFragment();
    frag.append(card2);
    if (state.sources.length) {
      frag.append(el("h3", null, "Listen to the raw recordings"));
      frag.append(recordingList(true));
    }
    inner.replaceChildren(frag);
  }
  var init_pending = __esm({
    "src/day/pending.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_recordings();
      init_queue();
      init_dialog();
      init_elements();
      init_format();
    }
  });

  // src/meetings/data.ts
  async function loadMeetings() {
    if (!state.server) return;
    try {
      state.meetings = (await api("/api/meetings")).meetings;
    } catch {
    }
  }
  function meetingStats(m) {
    const bits = [plural(m.lines, "line")];
    if (m.span) bits.push(fmtDur(m.span));
    if (m.days.length) bits.push(m.days.length === 1 ? shortDate(m.days[0]) : `${shortDate(m.days[0])} \u2013 ${shortDate(m.days[m.days.length - 1])}`);
    if (m.missing) bits.push(`${m.missing} marked ${m.missing === 1 ? "line is" : "lines are"} gone`);
    const s = el("div", "mt-stats");
    s.append(...bits.map((b) => el("span", null, b)));
    return s;
  }
  var marksOf, hasMark, mt;
  var init_data = __esm({
    "src/meetings/data.ts"() {
      init_state();
      init_api();
      init_elements();
      init_format();
      marksOf = (date, start) => (state.meetings || []).filter((m) => m.marks.some(([d, s]) => d === date && Math.abs(s - start) < 0.05));
      hasMark = (m, it) => m.marks.some(([d, s]) => d === it.date && Math.abs(s - it.start) < 0.05);
      mt = { open: null, timer: null, detail: null };
    }
  });

  // src/summary/markdown.ts
  function renderMarkdown(md, refs, opts = {}) {
    const root = el("div", "md");
    const doneKey = opts.doneKey || "summaryDone:" + state.date;
    const done = new Set(store.get(doneKey, []));
    const inline = (text, into) => {
      const rx = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[L\d+(?:\s*[-–,]\s*L?\d+)*\])/g;
      let pos = 0;
      for (const m of text.matchAll(rx)) {
        into.append(text.slice(pos, m.index));
        const t = m[0];
        if (t.startsWith("**")) into.append(el("strong", null, t.slice(2, -2)));
        else if (t.startsWith("`")) into.append(el("code", null, t.slice(1, -1)));
        else if (t.startsWith("[L")) {
          for (const part of t.slice(1, -1).split(/\s*,\s*/)) {
            const [r, last] = part.split(/\s*[-–]\s*/).map((x) => "L" + x.replace(/^L/, ""));
            const at = refs[r];
            if (at === void 0) continue;
            const far = typeof at === "object";
            const b = el("button", "ref", far ? `${shortDate(at.date)} ${at.at}` : clockAt(at) || fmt(at));
            b.title = far ? "Open this moment" : last && refs[last] !== void 0 ? `Play from here (${clockAt(at)}\u2013${clockAt(refs[last])})` : "Play from here";
            b.onclick = far ? () => go(at.date, at.start) : () => {
              state.userScrolledAt = 0;
              seek(at, true);
            };
            into.append(b);
          }
        } else into.append(el("em", null, t.slice(1, -1)));
        pos = m.index + t.length;
      }
      into.append(text.slice(pos));
    };
    const stack = [{ indent: -1, node: root }];
    let para = null;
    for (const raw of md.replace(/\r/g, "").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) {
        para = null;
        continue;
      }
      const head = /^(#{1,4})\s+(.*)$/.exec(line.trim());
      const item = /^(\s*)[-*+]\s+(.*)$/.exec(line) || /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
      if (head) {
        stack.length = 1;
        para = null;
        const hn = el("h" + Math.min(4, Math.max(2, head[1].length)));
        inline(head[2].replace(/\s*#+$/, ""), hn);
        root.append(hn);
      } else if (item) {
        para = null;
        const indent = item[1].replace(/\t/g, "  ").length;
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
        let top = stack[stack.length - 1];
        if (!top.list || indent > top.indent) {
          const ul = el("ul");
          (top.li || top.node).append(ul);
          top = { indent, node: ul, list: ul };
          stack.push(top);
        }
        const li = el("li");
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(item[2]);
        if (task) {
          const key = task[2].replace(/\[L[\d, L]+\]/g, "").trim().toLowerCase();
          const cb = el("input");
          cb.type = "checkbox";
          cb.checked = task[1] !== " " || done.has(key);
          const span = el("span");
          inline(task[2], span);
          li.className = "task" + (cb.checked ? " done" : "");
          cb.onchange = () => {
            cb.checked ? done.add(key) : done.delete(key);
            store.set(doneKey, [...done]);
            li.classList.toggle("done", cb.checked);
          };
          li.append(cb, span);
        } else inline(item[2], li);
        top.list.append(li);
        top.li = li;
      } else {
        stack.length = 1;
        if (!para) {
          para = el("p");
          root.append(para);
        } else para.append(" ");
        inline(line.trim(), para);
      }
    }
    return root;
  }
  var init_markdown = __esm({
    "src/summary/markdown.ts"() {
      init_state();
      init_helpers();
      init_library();
      init_audio();
      init_elements();
      init_format();
      init_store();
    }
  });

  // src/meetings/detail.ts
  function renderMeetingDetail(inner) {
    const m = mt.detail;
    $("subtitle").textContent = m.name;
    const frag = document.createDocumentFragment();
    const back = btn("\u2190 All meetings", "small", () => showMeetings());
    const top = el("div", "mt-top");
    top.style.marginTop = "12px";
    top.append(el("h2", "hello", m.name));
    top.lastChild.style.flex = "1";
    top.append(btn("Rename", "small", async () => {
      const n = prompt("Meeting name", m.name);
      if (!n || !n.trim() || n.trim() === m.name) return;
      try {
        await jsonPost(`/api/meetings/${m.id}/rename`, { name: n.trim() });
      } catch (e) {
        toast(e.message);
        return;
      }
      loadMeetingsPage();
    }), btn("Delete", "small danger", async () => {
      if (!confirm(`Delete \u201C${m.name}\u201D? The transcripts are not touched.`)) return;
      try {
        await api(`/api/meetings/${m.id}`, { method: "DELETE" });
      } catch (e) {
        toast(e.message);
        return;
      }
      toast("Meeting deleted");
      showMeetings();
    }));
    frag.append(back, top, meetingStats(m));
    if (m.people.length) {
      const who = el("div");
      m.people.forEach((p) => who.append(el("span", "ov-person", `${displayName(p.name)} \xB7 ${fmtDur(p.seconds)}`)));
      frag.append(who);
    }
    const r = m.summary_state;
    const box = el("section", "summary");
    const sh = el("div", "summary-head");
    const h3 = el("h3");
    h3.append(svg('<path d="M4 6h16M4 12h10M4 18h13"/>'), "Status");
    sh.append(h3, el("span", "meta", r.status === "ready" ? `${r.model}` : ""));
    const busy = ["queued", "running"].includes(r.status);
    const run = () => jsonPost(`/api/meetings/${m.id}/summary`, {}).then(loadMeetingsPage).catch((e) => toast(e.message));
    if (r.status === "ready" && !busy) {
      const copy = btn("Copy", "small", () => navigator.clipboard.writeText(r.markdown.replace(/\s*\[L[\d\sL,\u2013-]*\]/g, "")).then(() => toast("Summary copied")));
      sh.append(copy, btn("Regenerate", "small", run));
    }
    box.append(sh);
    const body = el("div", "summary-body");
    if (busy) {
      body.append(
        progressBar(r.progress || 0, (r.label || "Waiting") + "\u2026", r.progress ? `${Math.round(r.progress * 100)}%` : ""),
        el("p", "note", "Runs on this computer with Ollama.")
      );
    } else if (r.status === "failed") {
      const a = el("div", "actions");
      a.append(btn("Try again", "primary small", run));
      body.append(el("div", "error-box", r.error || "Something went wrong"), a);
    } else if (r.status === "ready") {
      if (r.outdated) {
        const st = el("div", "stale");
        st.append(el("span", null, "Lines were added or changed since this summary was written."), btn("Regenerate", "small", run));
        body.append(st);
      }
      body.append(renderMarkdown(r.markdown, r.refs || {}, { doneKey: "meetingDone:" + m.id }));
    } else if (!m.lines) {
      body.append(el("p", "lead", "This meeting has no lines yet."));
    } else {
      body.append(el("p", "lead", `Where things stand, decisions, action items and open questions, written by ${r.model} on this computer.`));
      const a = el("div", "actions");
      a.append(btn("Summarize this meeting", "primary", run));
      body.append(a);
    }
    box.append(body);
    frag.append(box);
    let day = null;
    for (const l of m.transcript) {
      if (l.date !== day) {
        day = l.date;
        frag.append(el("div", "mt-day", longDate(day)));
      }
      const row = el("div", "mt-line");
      const when = el("button", "prec", l.at);
      when.title = "Open this moment";
      when.onclick = () => go(l.date, l.start);
      const text = el("div");
      text.append(el("span", "who", displayName(l.speaker) + ": "), l.text);
      const rm = el("button", "btn small", "Remove");
      rm.title = "Take this line out of the meeting";
      rm.onclick = async () => {
        try {
          await jsonPost(`/api/meetings/${m.id}/items`, { remove: [{ date: l.date, start: l.start, text: l.text }] });
        } catch (e) {
          toast(e.message);
          return;
        }
        loadMeetingsPage();
      };
      row.append(when, text, rm);
      frag.append(row);
    }
    inner.replaceChildren(frag);
  }
  var init_detail = __esm({
    "src/meetings/detail.ts"() {
      init_dom();
      init_helpers();
      init_widgets();
      init_library();
      init_data();
      init_page();
      init_markdown();
      init_api();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/review/snippets.ts
  function stopSnip() {
    snip.pause();
    snipBtn?.classList.remove("playing");
    snipBtn?.querySelector("svg")?.replaceWith(svg(ICONS.play));
    snipBtn = null;
  }
  function playSnip(seg, b, url = state.data?.audio_url) {
    if (snipBtn === b) {
      stopSnip();
      return;
    }
    stopSnip();
    if (!url) {
      toast("No audio for this day");
      return;
    }
    if (!audio.paused) audio.pause();
    if (snip.getAttribute("src") !== url) snip.src = url;
    snipEnd = Math.min(seg.end, seg.start + 15) + 0.15;
    const go2 = () => {
      snip.currentTime = Math.max(0, seg.start - 0.1);
      snip.play().catch((e) => toast(`Couldn't play: ${e.message}`));
    };
    snip.readyState >= 1 ? go2() : snip.addEventListener("loadedmetadata", go2, { once: true });
    if (snip.readyState < 1) snip.load();
    snipBtn = b;
    b.classList.add("playing");
    b.querySelector("svg")?.replaceWith(svg(ICONS.pause));
  }
  function voiceSnippets(spk) {
    const lines = state.segments.filter((x) => x.speaker === spk && !x.noise && !x.overlap?.length);
    const score = (x) => {
      const d = x.end - x.start;
      return d < 1.2 ? d - 100 : Math.min(d, 15) - Math.max(0, d - 15) * 0.2;
    };
    return lines.sort((a, b) => score(b) - score(a));
  }
  function init3() {
    snip.preload = "none";
    state.reviewNamed = /* @__PURE__ */ new Set();
    state.reviewDraft = /* @__PURE__ */ new Map();
    state.reviewOk = /* @__PURE__ */ new Set();
    state.reviewSeen = /* @__PURE__ */ new Set();
    snip.addEventListener("timeupdate", () => {
      if (snip.currentTime >= snipEnd) stopSnip();
    });
    snip.addEventListener("ended", stopSnip);
  }
  var snip, snipEnd, snipBtn, SNIPS;
  var init_snippets = __esm({
    "src/review/snippets.ts"() {
      init_dom();
      init_state();
      init_elements();
      init_toast();
      snip = new Audio();
      snipEnd = 0;
      snipBtn = null;
      SNIPS = 5;
    }
  });

  // src/rename.ts
  function rename(spk) {
    const dlg = $("rename-dlg"), input = $("rename-input");
    input.value = displayName(spk);
    dlg.onclose = async () => {
      if (dlg.returnValue !== "ok") return;
      const v = input.value.trim();
      if (!v || v === displayName(spk)) return;
      try {
        const target = Object.keys(state.colors).find((k) => displayName(k).toLowerCase() === v.toLowerCase() && k !== spk) || v;
        const send = (merge) => api("/api/speakers/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ old: spk, new: target, merge })
        });
        let r, merged = false;
        try {
          r = await send(false);
        } catch (e) {
          if (e.status !== 409) throw e;
          $("merge-text").textContent = `${displayName(target)} already exists. Merge ${displayName(spk)} into ${displayName(target)}? All of ${displayName(spk)}'s lines on every day become ${displayName(target)}, and their voiceprints are pooled so future recordings match better.`;
          const ok = await new Promise((res) => {
            const d = $("merge-dlg");
            d.onclose = () => res(d.returnValue === "ok");
            d.returnValue = "";
            d.showModal();
          });
          if (!ok) return;
          r = await send(true);
          merged = true;
        }
        await refreshLibrary();
        await openDay(state.date, { keepPosition: true });
        toast(merged ? `Merged into ${displayName(target)}` : `Renamed to ${v} in ${plural(r.updated, "transcript")}`);
      } catch (e) {
        toast(e.message);
      }
    };
    dlg.showModal();
    input.select();
  }
  var init_rename = __esm({
    "src/rename.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_open();
      init_library();
      init_api();
      init_format();
      init_toast();
    }
  });

  // src/speakers/voice-actions.ts
  function stageVoiceReview(spk, kind, name) {
    state.reviewDraft.set(spk, { kind, name });
    state.reviewNamed.add(spk);
    renderVoiceReview();
  }
  function voiceSuggestions(spk) {
    const best = {};
    for (const v of state.data?.voices || []) {
      if (v.name !== spk) continue;
      for (const c of v.candidates || []) if (c.name !== spk) best[c.name] = Math.max(best[c.name] || 0, c.score);
    }
    return Object.entries(best).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score);
  }
  async function hideVoice(spk) {
    const date = state.date;
    const post = (body) => api(`/api/days/${date}/voice-noise`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let r;
    try {
      r = await post({ speaker: spk, noise: true });
    } catch (e) {
      toast(e.message);
      return;
    }
    await openDay(date, { keepPosition: true });
    if ($("voices-dlg").open) {
      state.reviewNamed.add(spk);
      renderVoiceReview();
    }
    toast(`${displayName(spk)} hidden as TV / music (${plural(r.changed.length, "line")})`, { action: "Undo", onAction: async () => {
      try {
        await post({ speaker: spk, noise: false, lines: r.changed });
      } catch (e) {
        toast(e.message);
        return;
      }
      if (state.date === date) await openDay(date, { keepPosition: true });
      if ($("voices-dlg").open) {
        state.reviewNamed.delete(spk);
        renderVoiceReview();
      }
      toast("Undone");
      refreshLibrary();
    } });
    refreshLibrary();
  }
  async function hideLine(s) {
    const date = state.date;
    const lines = [{ start: s.start, text: s.text }];
    const post = (noise) => api(`/api/days/${date}/voice-noise`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ speaker: s.speaker, noise, lines }) });
    try {
      await post(true);
    } catch (e) {
      toast(e.message);
      return;
    }
    state.editing = null;
    await openDay(date, { keepPosition: true });
    toast("Line hidden as TV / music", { action: "Undo", onAction: async () => {
      try {
        await post(false);
      } catch (e) {
        toast(e.message);
        return;
      }
      if (state.date === date) await openDay(date, { keepPosition: true });
      toast("Undone");
      refreshLibrary();
    } });
    refreshLibrary();
  }
  async function tvVoice(spk, name) {
    const date = state.date;
    const json = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let r;
    try {
      r = await json(`/api/days/${date}/tv-voice`, { speaker: spk, name });
    } catch (e) {
      toast(e.message);
      return;
    }
    await openDay(date, { keepPosition: true });
    if ($("voices-dlg").open) {
      state.reviewNamed.add(name);
      renderVoiceReview();
    }
    loadSpeakers();
    toast(`${displayName(spk)} is TV: ${name}${r.learned ? ". Recognised on new days too" : ""}`, { action: "Undo", onAction: async () => {
      try {
        if (r.shown.length) await json(`/api/days/${date}/voice-noise`, { speaker: name, noise: true, lines: r.shown });
        await json(`/api/days/${date}/relabel`, { old: name, new: spk, lines: r.changed, labels: r.labels });
      } catch (e) {
        toast(e.message);
        return;
      }
      if (state.date === date) await openDay(date, { keepPosition: true });
      if ($("voices-dlg").open) {
        state.reviewNamed.delete(name);
        renderVoiceReview();
      }
      loadSpeakers();
      toast("Undone");
      refreshLibrary();
    } });
    refreshLibrary();
  }
  async function relabelVoice(from, to) {
    const date = state.date;
    const post = (body) => api(`/api/days/${date}/relabel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let r;
    try {
      r = await post({ old: from, new: to });
    } catch (e) {
      toast(e.message);
      return;
    }
    await openDay(date, { keepPosition: true });
    if ($("voices-dlg").open) {
      state.reviewNamed.add(to);
      renderVoiceReview();
    }
    loadSpeakers();
    toast(r.learned ? `${displayName(from)} is ${displayName(to)}. ${displayName(to)}'s voice will be recognised on new days` : `${displayName(from)} is ${displayName(to)} on this day`, { action: "Undo", onAction: async () => {
      try {
        await post({ old: to, new: from, lines: r.changed, labels: r.labels });
      } catch (e) {
        toast(e.message);
        return;
      }
      if (state.date === date) await openDay(date, { keepPosition: true });
      if ($("voices-dlg").open) {
        state.reviewNamed.delete(to);
        renderVoiceReview();
      }
      toast("Undone");
      refreshLibrary();
    } });
    refreshLibrary();
  }
  var init_voice_actions = __esm({
    "src/speakers/voice-actions.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_open();
      init_library();
      init_dialog2();
      init_panel();
      init_api();
      init_format();
      init_toast();
    }
  });

  // src/split/state.ts
  function nextUnsorted(from) {
    for (let k = from; k < split.order.length; k++) if (!split.pick.has(split.order[k])) return k;
    for (let k = 0; k < from; k++) if (!split.pick.has(split.order[k])) return k;
    return -1;
  }
  var split, SKIP, splitNames, slotOf;
  var init_state2 = __esm({
    "src/split/state.ts"() {
      split = { spk: null, slots: [], order: [], i: 0, pick: /* @__PURE__ */ new Map(), hist: [], sugg: /* @__PURE__ */ new Map(), playBtn: null };
      SKIP = "__skip__";
      splitNames = () => split.slots.map((s) => s.trim());
      slotOf = (name) => splitNames().indexOf(name);
    }
  });

  // src/split/actions.ts
  function playSplit() {
    const seg = split.order[split.i];
    if (!seg || !split.playBtn) return;
    if (snipBtn === split.playBtn) stopSnip();
    playSnip(seg, split.playBtn);
  }
  function splitPick(p) {
    const seg = split.order[split.i];
    if (!seg || p !== SKIP && !splitNames()[p]) return;
    split.hist.push({ seg, prev: split.pick.get(seg), i: split.i });
    split.pick.set(seg, p);
    const k = nextUnsorted(split.i + 1);
    split.i = k < 0 ? split.order.length : k;
    renderSplitPeople();
    renderSplit();
    playSplit();
  }
  function splitBack() {
    const h = split.hist.pop();
    if (!h) return;
    if (h.prev === void 0) split.pick.delete(h.seg);
    else split.pick.set(h.seg, h.prev);
    split.i = h.i;
    renderSplitPeople();
    renderSplit();
    playSplit();
  }
  function splitAccept(entries) {
    for (const [seg, g] of entries) {
      const i = slotOf(g.person);
      if (i >= 0 && !split.pick.has(seg)) {
        split.hist.push({ seg, prev: void 0, i: split.i });
        split.pick.set(seg, i);
      }
    }
    const k = nextUnsorted(split.i);
    split.i = k < 0 ? split.order.length : k;
    renderSplitPeople();
    renderSplit();
    playSplit();
  }
  async function splitSuggest() {
    const names = splitNames();
    const seeds = {};
    for (const [seg, p] of split.pick) if (p !== SKIP && names[p]) (seeds[names[p]] ||= []).push({ start: seg.start, text: seg.text });
    const tools = $("split-tools");
    tools.append(el("span", "muted", "Listening\u2026 (the first time loads the voice model)"));
    let r;
    try {
      r = await api(`/api/days/${state.date}/voice-split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker: split.spk, seeds })
      });
    } catch (e) {
      toast(e.message);
      renderSplit();
      return;
    }
    split.sugg = /* @__PURE__ */ new Map();
    for (const l of r.lines) {
      const seg = split.order.find((s) => sameLine(s, l));
      if (seg) split.sugg.set(seg, l);
    }
    toast(r.lines.length ? `${plural(r.lines.length, "line")} sound like someone you named` : "No other lines sound clearly like them yet. Sort a few more and try again.");
    renderSplit();
  }
  async function splitSave() {
    const names = splitNames();
    const old = [], neu = [], teachBy = {};
    for (const [seg, p] of split.pick) {
      if (p === SKIP || !names[p] || names[p] === seg.speaker) continue;
      old.push(seg);
      neu.push({ ...seg, speaker: names[p], edited: true });
      if (!names[p].startsWith("Unknown")) (teachBy[names[p]] ||= []).push({ start: seg.start, text: seg.text });
    }
    stopSnip();
    $("split-dlg").close();
    if (!old.length) return;
    const date = state.date;
    await replaceLines(old, neu, `Split ${displayName(split.spk)}: moved ${plural(old.length, "line")}`);
    for (const [person, lines] of Object.entries(teachBy)) {
      try {
        await api(`/api/days/${date}/voice-train`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ person, lines }) });
      } catch (e) {
        toast(`Couldn't teach ${displayName(person)}: ${e.message}`);
      }
    }
    loadSpeakers();
  }
  function init4() {
    $("split-save").addEventListener("click", splitSave);
    $("split-cancel").addEventListener("click", stopSnip);
    $("split-dlg").addEventListener("close", stopSnip);
    $("split-dlg").addEventListener("keydown", (e) => {
      if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (/^[1-4]$/.test(k) && split.slots[+k - 1] !== void 0) {
        e.preventDefault();
        splitPick(+k - 1);
      } else if (k === "s") {
        e.preventDefault();
        splitPick(SKIP);
      } else if (k === "z") {
        e.preventDefault();
        splitBack();
      } else if (k === " ") {
        e.preventDefault();
        playSplit();
      } else if (k === "enter") {
        e.preventDefault();
        const g = split.sugg.get(split.order[split.i]);
        if (g && slotOf(g.person) >= 0) splitPick(slotOf(g.person));
      }
    });
  }
  var init_actions = __esm({
    "src/split/actions.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_snippets();
      init_panel();
      init_render();
      init_state2();
      init_tray();
      init_edit();
      init_api();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/split/render.ts
  function openSplit(spk) {
    if (!state.server || !isReady()) return;
    if ($("voices-dlg").open) $("voices-dlg").close();
    stopSnip();
    Object.assign(split, { spk, slots: ["", "", ""], i: 0, pick: /* @__PURE__ */ new Map(), hist: [], sugg: /* @__PURE__ */ new Map() });
    split.order = state.segments.filter((s) => s.speaker === spk && !s.noise).sort((a, b) => b.end - b.start - (a.end - a.start));
    $("split-title").textContent = `Split ${displayName(spk)} \xB7 ${plural(split.order.length, "line")}`;
    renderSplitPeople();
    renderSplit();
    $("split-dlg").showModal();
    playSplit();
  }
  function renderSplitPeople() {
    const box = $("split-people");
    const dl = el("datalist");
    dl.id = "split-names";
    [.../* @__PURE__ */ new Set([...state.allSpeakers || [], ...state.tvNames || [], ...Object.keys(state.colors)])].filter((n) => n && n !== split.spk && !n.startsWith("Unknown")).sort((a, b) => a.localeCompare(b)).forEach((n) => {
      const o = el("option");
      o.value = n;
      dl.append(o);
    });
    box.replaceChildren(dl, ...split.slots.map((v, i) => {
      const row = el("div", "split-slot");
      const inp = el("input");
      inp.value = v;
      inp.setAttribute("list", "split-names");
      inp.placeholder = i === 0 ? "Person 1, e.g. Kenzie Meadows" : `Person ${i + 1}`;
      inp.oninput = () => {
        split.slots[i] = inp.value;
        renderSplit();
      };
      inp.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          inp.blur();
        }
      };
      const n = [...split.pick.values()].filter((p) => p === i).length;
      row.append(el("kbd", null, String(i + 1)), inp, el("span", "n", n ? plural(n, "line") : ""));
      return row;
    }));
    if (split.slots.length < 4) {
      const add = btn("+ Another person", "small", () => {
        split.slots.push("");
        renderSplitPeople();
        renderSplit();
      });
      add.type = "button";
      box.append(add);
    }
  }
  function renderSplit() {
    const card2 = $("split-card");
    const names = splitNames();
    const done = split.pick.size, total = split.order.length;
    const seg = split.order[split.i];
    card2.replaceChildren();
    if (!seg || split.i < 0) {
      card2.append(el("div", "say", "Every line is sorted."), el("div", "meta", "Press Save to move them. You can still press Z to go back."));
    } else {
      const picked = split.pick.get(seg);
      const sg = split.sugg.get(seg);
      card2.append(el("div", "meta", `${clockAt(seg.start) || fmt(seg.start)} \xB7 ${(seg.end - seg.start).toFixed(1)} s` + (picked !== void 0 ? ` \xB7 sorted: ${picked === SKIP ? "skipped" : displayName(names[picked] || "?")}` : "") + (seg.overlap?.length ? ` \xB7 talking over: ${seg.overlap.map(displayName).join(", ")}` : "")));
      card2.append(el("div", "say", seg.text));
      const keys = el("div", "keys");
      const play = btn("", "small", () => playSplit());
      play.type = "button";
      play.append(svg(ICONS.play), " Replay");
      split.playBtn = play;
      keys.append(play);
      names.forEach((n, i) => {
        const b = btn(`${i + 1} \xB7 ${n ? displayName(n) : `Person ${i + 1}`}`, "small" + (sg && sg.person === n ? " sugg" : ""), () => splitPick(i));
        b.type = "button";
        b.disabled = !n;
        keys.append(b);
      });
      const sk = btn("S \xB7 Skip", "small", () => splitPick(SKIP));
      sk.type = "button";
      keys.append(sk);
      const bk = btn("Z \xB7 Back", "small", () => splitBack());
      bk.type = "button";
      bk.disabled = !split.hist.length;
      keys.append(bk);
      card2.append(keys);
      if (sg) card2.append(el("div", "meta", `Sounds like ${displayName(sg.person)} \xB7 ${Math.round(sg.score * 100)}%${sg.strong ? " (strong)" : ""}. Enter to accept.`));
    }
    const tools = $("split-tools");
    const bar = el("div", "split-bar");
    const fill = el("i");
    fill.style.width = `${total ? done / total * 100 : 0}%`;
    bar.append(fill);
    const tagged = names.map((n, i) => n ? [...split.pick.values()].filter((p) => p === i).length : 0);
    const ready = tagged.filter((n) => n > 0).length >= 1 && names.filter(Boolean).length >= 1;
    const sug = btn("Suggest the rest by voice", "small", () => splitSuggest());
    sug.type = "button";
    sug.disabled = !ready;
    sug.title = ready ? "Score every unsorted line against the lines you sorted" : "Sort a few lines per person first";
    const open = [...split.sugg.entries()].filter(([s]) => !split.pick.has(s));
    const strong = open.filter(([, g]) => g.strong);
    tools.replaceChildren(el("span", null, `${done} / ${total} sorted`), bar, sug);
    if (open.length) {
      const acc = btn(`Accept ${strong.length} strong`, "small", () => splitAccept(strong));
      acc.type = "button";
      acc.disabled = !strong.length;
      const all = btn(`Accept all ${open.length} suggestions`, "small", () => splitAccept(open));
      all.type = "button";
      tools.append(acc, all);
    }
    $("split-save").disabled = ![...split.pick.values()].some((p) => p !== SKIP);
  }
  var init_render = __esm({
    "src/split/render.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_widgets();
      init_snippets();
      init_actions();
      init_state2();
      init_elements();
      init_format();
    }
  });

  // src/review/voice-card.ts
  function voiceCard(v, member = false) {
    const draft = state.reviewDraft.get(v.spk);
    const sure = !!draft || v.match > 0 || v.named || state.reviewNamed.has(v.spk) || state.reviewOk.has(v.spk);
    const card2 = el(member || sure ? "details" : "div", member ? "vr-member" : "vr" + (sure ? "" : " unsure"));
    const head = el("div", "vr-head");
    const dot = el("span", "dot");
    dot.style.background = state.colors[v.spk];
    head.append(dot, el("span", "nm", displayName(v.spk)), el("span", "meta", `${fmtDur(v.talk)} talking \xB7 ${plural(v.lines.length, "line")}`), el("span", "grow"));
    const sugg = voiceSuggestions(v.spk);
    const best = (state.data?.voices || []).filter((x) => x.name === v.spk).flatMap((x) => x.candidates || []).sort((a, b) => b.score - a.score)[0];
    const selfScore = best && best.name === v.spk ? best.score : 0;
    let status;
    if (draft) status = el("span", "vr-status ok", draft.kind === "hide" ? "Pending \xB7 hidden" : `Pending \xB7 ${displayName(draft.name)}`);
    else if (state.reviewNamed.has(v.spk) || v.named) status = el("span", "vr-status ok", "Named by you");
    else if (state.reviewOk.has(v.spk)) status = el("span", "vr-status ok", "Confirmed");
    else if (v.match > 0) status = el("span", "vr-status ok", `Recognised \xB7 ${Math.round(v.match * 100)}%`);
    else if (selfScore) status = el("span", "vr-status", `Sounds like ${displayName(v.spk)} \xB7 ${Math.round(selfScore * 100)}%`);
    else if (sugg[0]) status = el("span", "vr-status", `Sounds like ${displayName(sugg[0].name)} \xB7 ${Math.round(sugg[0].score * 100)}%`);
    else status = el("span", "vr-status", "New voice");
    head.append(status);
    if (draft) {
      const undo = btn("Undo", "small", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.reviewDraft.delete(v.spk);
        state.reviewNamed.delete(v.spk);
        renderVoiceReview();
      });
      undo.type = "button";
      head.append(undo);
    }
    const confirmable = !draft && !v.named && !state.reviewOk.has(v.spk) && !state.reviewNamed.has(v.spk);
    if (confirmable && (v.match > 0 || selfScore)) {
      const ok = btn("Confirm", "small", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.reviewOk.add(v.spk);
        renderVoiceReview();
      });
      ok.type = "button";
      head.append(ok);
    } else if (confirmable && sugg[0]) {
      const ok = btn("Confirm", "small", (e) => {
        e.preventDefault();
        e.stopPropagation();
        stageVoiceReview(v.spk, "person", sugg[0].name);
      });
      ok.type = "button";
      ok.title = `Confirm this voice as ${displayName(sugg[0].name)}`;
      head.append(ok);
    }
    const recs = [...new Set(v.lines.map((x) => srcIndexAt(x.start)).filter((i) => i >= 0))].sort((a, b) => a - b);
    const recText = recs.length ? `In ${plural(recs.length, "recording")}: ` + recs.map((i) => clock(state.sources[i].recorded_at) || state.sources[i].name || `#${i + 1}`).join(", ") : "";
    const top = sure || member ? el("summary") : el("div");
    top.append(head);
    if (recText) top.append(el("div", "vr-recs", recText));
    card2.append(top);
    const body = el("div", "vr-body");
    const list = el("div", "vr-snips");
    const all = voiceSnippets(v.spk);
    let shown = 0;
    const more = btn("More lines", "small", () => addSnips());
    more.type = "button";
    const addSnips = () => {
      for (const seg of all.slice(shown, shown + SNIPS)) {
        const b = el("button", "vr-snip");
        b.type = "button";
        b.title = "Play this line";
        b.append(svg(ICONS.play), el("span", "tm", clockAt(seg.start) || fmt(seg.start)), el("span", "tx", seg.text));
        b.onclick = () => playSnip(seg, b);
        list.insertBefore(b, more);
      }
      shown += SNIPS;
      more.classList.toggle("hidden", shown >= all.length);
    };
    list.append(more);
    if (!all.length) list.prepend(el("div", "note", "No clear lines to play (everything overlaps or is very short)."));
    const side = el("div");
    const sp = btn("Several people? Split\u2026", "small", () => openSplit(v.spk));
    sp.type = "button";
    sp.title = "This voice mixes several people: sort its lines between them";
    side.append(el("div", "vr-sect", "Who is this?"), whoPicker(v.spk, true), sp);
    body.append(list, side);
    card2.append(body);
    if (card2.tagName === "DETAILS") card2.ontoggle = () => {
      if (card2.open && !shown) addSnips();
    };
    else addSnips();
    return card2;
  }
  function voiceGroup(group) {
    const card2 = el("details", "vr vr-group");
    const summary = el("summary");
    const head = el("div", "vr-head");
    const dot = el("span", "dot");
    dot.style.background = state.colors[group.name] || "var(--accent)";
    const talk = group.voices.reduce((sum, v) => sum + v.talk, 0);
    head.append(
      dot,
      el("span", "nm", group.kind === "hide" ? "Hidden as TV / music" : displayName(group.name)),
      el("span", "meta", `${fmtDur(talk)} talking \xB7 ${plural(group.voices.length, "voice")}`),
      el("span", "grow"),
      el("span", "vr-status ok", "Pending \xB7 expand to review")
    );
    summary.append(head);
    card2.append(summary, ...group.voices.map((v) => {
      const member = voiceCard(v, true);
      member.open = true;
      return member;
    }));
    return card2;
  }
  var init_voice_card = __esm({
    "src/review/voice-card.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_widgets();
      init_dialog2();
      init_snippets();
      init_voice_actions();
      init_who_picker();
      init_render();
      init_elements();
      init_format();
    }
  });

  // src/review/dialog.ts
  function renderVoiceReview() {
    stopSnip();
    const talk = {}, lines = {};
    for (const x of state.segments) {
      if (x.noise) continue;
      talk[x.speaker] = (talk[x.speaker] || 0) + Math.max(0, x.end - x.start);
      (lines[x.speaker] ||= []).push(x);
    }
    const voices = Object.keys(talk).map((spk) => ({
      spk,
      talk: talk[spk],
      lines: lines[spk],
      match: Math.max(0, ...(state.data?.voices || []).filter((x) => x.name === spk).map((x) => x.match || 0)),
      named: (state.data?.voices || []).some((x) => x.name === spk && x.named)
    }));
    const isSure = (v) => v.match > 0 || v.named || state.reviewNamed.has(v.spk) || state.reviewOk.has(v.spk);
    const unsure = voices.filter((v) => !state.reviewDraft.has(v.spk) && !isSure(v)).sort((a, b) => b.talk - a.talk);
    const sure = voices.filter((v) => !state.reviewDraft.has(v.spk) && isSure(v)).sort((a, b) => b.talk - a.talk);
    const frag = document.createDocumentFragment();
    if (state.reviewDraft.size) {
      const groups = /* @__PURE__ */ new Map();
      for (const [spk, draft] of state.reviewDraft) {
        const key = `${draft.kind}:${draft.name}`;
        if (!groups.has(key)) groups.set(key, { ...draft, voices: [] });
        const v = voices.find((v2) => v2.spk === spk) || { spk, talk: 0, lines: [], match: 0, named: false };
        groups.get(key).voices.push(v);
      }
      for (const group of groups.values()) {
        const destination = voices.find((v) => v.spk === group.name && !state.reviewDraft.has(v.spk));
        if (destination && !group.voices.includes(destination)) group.voices.unshift(destination);
      }
      const cards = [...groups.values()].map((group) => group.voices.length > 1 ? voiceGroup(group) : voiceCard(group.voices[0]));
      frag.append(el("div", "vr-sect", `Pending assignments \xB7 ${plural(state.reviewDraft.size, "assignment")}`), ...cards);
    }
    if (unsure.length) frag.append(el("div", "vr-sect", `Not sure who these are \xB7 ${unsure.length}`), ...unsure.map((v) => voiceCard(v)));
    if (sure.length) frag.append(el("div", "vr-sect", `Named or recognised \xB7 ${sure.length}`), ...sure.map((v) => voiceCard(v)));
    if (!voices.length) frag.append(el("p", "note", "Nobody said anything on this day."));
    $("voices-list").replaceChildren(frag);
    $("voices-title").textContent = `Who was talking on ${shortDate(state.date)}?`;
    $("voices-done").textContent = state.reviewDraft.size ? `Save ${plural(state.reviewDraft.size, "assignment")} and finish` : unsure.length ? `Save and finish (${plural(unsure.length, "voice")} left unnamed)` : "Save and finish";
  }
  function openVoiceReview() {
    if (!state.server || !isReady()) return;
    state.reviewSeen.add(state.date);
    state.reviewOk = /* @__PURE__ */ new Set();
    state.reviewNamed = /* @__PURE__ */ new Set();
    if (!state.reviewDraft.size) state.reviewDraft = /* @__PURE__ */ new Map();
    renderVoiceReview();
    if (!$("voices-dlg").open) $("voices-dlg").showModal();
  }
  function init5() {
    $("voices-dlg").addEventListener("close", stopSnip);
    $("voices-dlg").addEventListener("click", (e) => {
      if (e.target.closest(".row .btn")) stopSnip();
    });
    $("voices-done").addEventListener("click", async (e) => {
      e.preventDefault();
      const date = state.date;
      if (!date) return;
      const button = $("voices-done");
      button.disabled = true;
      const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const saved = [];
      try {
        for (const [speaker, assignment] of state.reviewDraft) {
          let result;
          if (assignment.kind === "person") result = await post(`/api/days/${date}/relabel`, { old: speaker, new: assignment.name });
          else if (assignment.kind === "tv") result = await post(`/api/days/${date}/tv-voice`, { speaker, name: assignment.name });
          else result = await post(`/api/days/${date}/voice-noise`, { speaker, noise: true });
          saved.push({ speaker, assignment, result });
        }
        await post(`/api/days/${date}/voices/reviewed`, { reviewed: true });
        if (state.data) state.data.voices_reviewed = true;
        state.reviewDraft.clear();
        if (state.date === date) await openDay(date, { keepPosition: true });
        if ($("voices-dlg").open) $("voices-dlg").close();
        refreshLibrary();
        toast("Voice assignments saved");
      } catch (error) {
        let rollbackFailed = false;
        for (const item of saved.reverse()) {
          const { speaker, assignment, result } = item;
          try {
            if (assignment.kind === "person") {
              await post(`/api/days/${date}/relabel`, { old: assignment.name, new: speaker, lines: result.changed, labels: result.labels });
            } else if (assignment.kind === "tv") {
              if (result.shown?.length) await post(`/api/days/${date}/voice-noise`, { speaker: assignment.name, noise: true, lines: result.shown });
              await post(`/api/days/${date}/relabel`, { old: assignment.name, new: speaker, lines: result.changed, labels: result.labels });
            } else {
              await post(`/api/days/${date}/voice-noise`, { speaker, noise: false, lines: result.changed });
            }
          } catch {
            rollbackFailed = true;
          }
        }
        if (rollbackFailed) {
          state.reviewDraft = /* @__PURE__ */ new Map();
          if (state.date === date) await openDay(date, { keepPosition: true });
          toast(`Save failed and some changes could not be undone: ${error.message}`);
        } else toast(saved.length ? `Save failed; changes rolled back. ${error.message}` : error.message);
      } finally {
        button.disabled = false;
      }
    });
  }
  var init_dialog2 = __esm({
    "src/review/dialog.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_open();
      init_library();
      init_snippets();
      init_voice_card();
      init_api();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/speakers/who-picker.ts
  function whoPicker(spk, reviewMode = false) {
    const box = el("div", "who-row");
    const sel = el("select");
    sel.title = "Who is this voice? (changes this day only)";
    sel.setAttribute("aria-label", `Who is ${displayName(spk)}?`);
    const names = [.../* @__PURE__ */ new Set([spk, ...state.allSpeakers || [], ...Object.keys(state.colors)])].filter((n) => n && !n.startsWith("Unknown") || n === spk);
    const sugg = voiceSuggestions(spk);
    const self = el("option", null, `${displayName(spk)} (this voice)`);
    self.value = spk;
    sel.append(self);
    if (sugg.length) {
      const g = el("optgroup");
      g.label = "Suggested by voice";
      sugg.forEach((c) => {
        const o = el("option", null, `${displayName(c.name)} \xB7 ${Math.round(c.score * 100)}% match`);
        o.value = c.name;
        g.append(o);
      });
      sel.append(g);
    }
    const everyone = el("optgroup");
    everyone.label = "Everyone";
    names.filter((n) => n !== spk).forEach((n) => {
      const o = el("option", null, displayName(n));
      o.value = n;
      everyone.append(o);
    });
    sel.append(everyone);
    const nw = el("option", null, "New person\u2026");
    nw.value = "__new__";
    sel.append(nw);
    const tvg = el("optgroup");
    tvg.label = "TV / YouTube (learned, kept, not a person)";
    (state.tvNames || []).forEach((n) => {
      const o = el("option", null, `TV: ${n}`);
      o.value = "tv:" + n;
      tvg.append(o);
    });
    const tvNew = el("option", null, "New TV channel / show\u2026");
    tvNew.value = "__tvnew__";
    tvg.append(tvNew);
    const hide = el("option", null, "Just hide (don\u2019t learn)");
    hide.value = "__hide__";
    tvg.append(hide);
    sel.append(tvg);
    const draft = reviewMode && state.reviewDraft.get(spk);
    if (draft) {
      const value = draft.kind === "hide" ? "__hide__" : draft.kind === "tv" ? "tv:" + draft.name : draft.name;
      if (![...sel.options].some((o) => o.value === value)) {
        const option = el("option", null, draft.kind === "hide" ? "Just hide (don\u2019t learn)" : displayName(draft.name));
        option.value = value;
        sel.append(option);
      }
      sel.value = value;
    } else sel.value = spk;
    const input = el("input");
    input.placeholder = "Name, then Enter";
    input.classList.add("hidden");
    let tvMode = false;
    const assign = (kind, name) => {
      if (reviewMode) stageVoiceReview(spk, kind, name);
      else if (kind === "tv") tvVoice(spk, name);
      else if (kind === "hide") hideVoice(spk);
      else relabelVoice(spk, name);
    };
    const apply = (name) => {
      name = (name || "").trim();
      if (!name || name === spk) {
        if (reviewMode && state.reviewDraft.has(spk)) {
          state.reviewDraft.delete(spk);
          state.reviewNamed.delete(spk);
          renderVoiceReview();
          return;
        }
        sel.value = spk;
        input.classList.add("hidden");
        sel.classList.remove("hidden");
        return;
      }
      assign(tvMode ? "tv" : "person", name);
    };
    const restoreDraftSelection = () => {
      if (!reviewMode) return;
      const draft2 = state.reviewDraft.get(spk);
      if (!draft2) {
        sel.value = spk;
        return;
      }
      const value = draft2.kind === "hide" ? "__hide__" : draft2.kind === "tv" ? "tv:" + draft2.name : draft2.name;
      if ([...sel.options].some((o) => o.value === value)) sel.value = value;
      else sel.value = spk;
    };
    sel.onchange = () => {
      if (sel.value === "__new__" || sel.value === "__tvnew__") {
        tvMode = sel.value === "__tvnew__";
        input.placeholder = tvMode ? "Channel or show, then Enter" : "Name, then Enter";
        sel.classList.add("hidden");
        input.classList.remove("hidden");
        input.focus();
      } else if (sel.value === "__hide__") {
        assign("hide", "");
      } else if (sel.value.startsWith("tv:")) {
        const n = sel.value.slice(3);
        assign("tv", n);
      } else if (sel.value === spk) {
        if (reviewMode) {
          state.reviewDraft.delete(spk);
          state.reviewNamed.delete(spk);
          renderVoiceReview();
        }
      } else apply(sel.value);
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        apply(input.value);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        restoreDraftSelection();
        input.classList.add("hidden");
        sel.classList.remove("hidden");
      }
    };
    input.onblur = () => {
      if (!input.classList.contains("hidden")) apply(input.value || "");
    };
    box.append(sel, input);
    const v = (state.data?.voices || []).filter((x) => x.name === spk);
    const match = Math.max(0, ...v.map((x) => x.match || 0));
    if (match) box.append(el("div", "who-note", `Recognised by voice \xB7 ${Math.round(match * 100)}% match`));
    else if (sugg[0]) {
      const maybe = el("button", "btn small maybe", `Maybe ${displayName(sugg[0].name)}? ${Math.round(sugg[0].score * 100)}%`);
      maybe.type = "button";
      maybe.title = `This voice sounds most like ${displayName(sugg[0].name)}. Click to use that name on this day.`;
      maybe.onclick = () => assign("person", sugg[0].name);
      box.append(maybe);
    }
    return box;
  }
  var init_who_picker = __esm({
    "src/speakers/who-picker.ts"() {
      init_state();
      init_helpers();
      init_dialog2();
      init_voice_actions();
      init_elements();
    }
  });

  // src/meetings/picker.ts
  function openMeetingPicker(segs, what) {
    if (!segs.length) {
      toast("There are no lines to add");
      return;
    }
    const items = segs.map((s) => ({ date: state.date, start: s.start, text: s.text }));
    const dlg = $("meeting-dlg"), list = $("meeting-list"), name = $("meeting-new");
    $("meeting-title").textContent = `${what} \xB7 ${plural(items.length, "line")}`;
    name.value = "";
    const refresh = async () => {
      await loadMeetings();
      draw();
      if (state.view === "day" && !state.editing) renderTranscript();
    };
    const draw = () => {
      const ms = state.meetings || [];
      list.replaceChildren(...ms.length ? ms.map((m) => {
        const all = items.every((it) => hasMark(m, it));
        const row = el("div", "item");
        row.append(el("span", "nm", m.name), el("span", "muted", plural(m.lines, "line")));
        const b = el("button", "btn small" + (all ? "" : " primary"), all ? "Remove" : "Add");
        b.type = "button";
        b.onclick = async () => {
          try {
            await jsonPost(`/api/meetings/${m.id}/items`, all ? { remove: items } : { add: items });
          } catch (e) {
            toast(e.message);
            return;
          }
          toast(all ? `Removed from ${m.name}` : `Added to ${m.name}`);
          refresh();
        };
        row.append(b);
        return row;
      }) : [el("div", "note", "No meetings yet. Create the first one below.")]);
    };
    const create = async () => {
      const n = name.value.trim();
      if (!n) {
        name.focus();
        return;
      }
      try {
        await jsonPost("/api/meetings", { name: n, items });
      } catch (e) {
        toast(e.message);
        return;
      }
      toast(`Created \u201C${n}\u201D`);
      name.value = "";
      refresh();
    };
    $("meeting-create").onclick = create;
    name.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        create();
      }
    };
    draw();
    dlg.showModal();
    loadMeetings().then(draw);
  }
  var init_picker = __esm({
    "src/meetings/picker.ts"() {
      init_dom();
      init_state();
      init_data();
      init_render2();
      init_api();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/transcript/editor.ts
  function openEditor(s, row) {
    if (state.editing) renderTranscript();
    row = document.querySelector(`.cue[data-i="${s.i}"]`)?.closest(".cue-row") || row;
    audio.pause();
    state.editing = s;
    const box = el("div", "line-editor");
    const ta = el("textarea");
    ta.value = s.text;
    ta.rows = Math.max(2, Math.ceil(s.text.length / 70));
    ta.setAttribute("aria-label", "Line text");
    const who = el("select");
    who.title = "Who said this line";
    const names = [.../* @__PURE__ */ new Set([...Object.keys(state.colors), ...state.allSpeakers || [], ...state.tvNames || []])].filter(Boolean);
    names.forEach((n) => {
      const o = el("option", null, displayName(n));
      o.value = n;
      who.append(o);
    });
    const nw = el("option", null, "New person\u2026");
    nw.value = "__new__";
    who.append(nw);
    const tv = el("option", null, "TV / music: hide this line");
    tv.value = "__hide__";
    who.append(tv);
    who.value = s.speaker;
    const newName = el("input");
    newName.placeholder = "Name";
    newName.classList.add("hidden");
    who.onchange = () => {
      if (who.value === "__hide__") {
        who.value = s.speaker;
        hideLine(s);
        return;
      }
      newName.classList.toggle("hidden", who.value !== "__new__");
      if (who.value === "__new__") newName.focus();
    };
    const speaker = () => who.value === "__new__" ? newName.value.trim() : who.value;
    const tidy = (t) => t.replace(/\s+/g, " ").trim();
    const idx = state.segments.indexOf(s);
    const next = state.segments[idx + 1];
    const close = () => {
      state.editing = null;
      renderTranscript();
    };
    const save = () => {
      const text = tidy(ta.value), sp = speaker();
      if (!text) {
        toast("A line can\u2019t be empty. Use the bin to remove it.");
        return;
      }
      if (!sp) {
        toast("Type the new person\u2019s name");
        newName.focus();
        return;
      }
      if (text === s.text && sp === s.speaker) {
        close();
        return;
      }
      replaceLines(
        [s],
        [{ ...s, text, speaker: sp, edited: true }],
        sp !== s.speaker && text === s.text ? `Moved to ${displayName(sp)}` : "Line saved"
      );
      if (sp !== s.speaker) addToTeach({ start: s.start, end: s.end, text, person: sp });
    };
    const split2 = () => {
      const text = ta.value, pos = ta.selectionStart;
      const left = tidy(text.slice(0, pos)), right = tidy(text.slice(pos));
      if (!left || !right) {
        toast("Put the cursor where the line should split, then press Split");
        ta.focus();
        return;
      }
      const t = Math.round((s.start + (s.end - s.start) * pos / Math.max(text.length, 1)) * 100) / 100;
      const sp = speaker() || s.speaker;
      replaceLines([s], [
        { start: s.start, end: t, speaker: sp, text: left, edited: true },
        { start: t, end: s.end, speaker: sp, text: right, edited: true }
      ], "Line split in two");
    };
    const join = () => {
      if (!next) return;
      replaceLines([s, next], [{
        start: s.start,
        end: Math.max(s.end, next.end),
        speaker: speaker() || s.speaker,
        text: tidy(`${ta.value} ${next.text}`),
        edited: true
      }], "Lines joined");
    };
    const b = (label, cls, fn, title) => {
      const x = el("button", "btn small " + cls, label);
      x.type = "button";
      x.onclick = fn;
      if (title) x.title = title;
      return x;
    };
    const joinBtn = b(
      "Join with next",
      "",
      join,
      next ? `Add the next line ("${next.text.slice(0, 40)}${next.text.length > 40 ? "\u2026" : ""}") to this one` : "This is the last line"
    );
    joinBtn.disabled = !next;
    const bar = el("div", "editor-bar");
    bar.append(
      who,
      newName,
      b("Split at cursor", "", split2, "Split this line into two where the text cursor is"),
      joinBtn,
      el("span", "grow"),
      el("span", "hint", "Enter to save \xB7 Esc to cancel"),
      b("Cancel", "", close),
      b("Save", "primary", save)
    );
    box.append(ta, bar);
    row.replaceChildren(box);
    const keys = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    ta.onkeydown = keys;
    newName.onkeydown = keys;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  var init_editor = __esm({
    "src/transcript/editor.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_voice_actions();
      init_tray();
      init_edit();
      init_render2();
      init_elements();
      init_toast();
    }
  });

  // src/transcript/noise.ts
  function renderNoiseCtl(n) {
    $("noise-ctl").classList.toggle("hidden", !n);
    $("noise-toggle").textContent = state.showNoise ? `Hide likely noise (${n})` : `${plural(n, "noise line")} hidden`;
    $("noise-toggle").title = "Lines that are probably clothing rustle or other noise rather than speech";
    $("noise-trash").classList.toggle("hidden", !state.showNoise);
    $("noise-trash").textContent = `Trash all ${n}`;
  }
  function reindex() {
    state.segments.forEach((s, i) => s.i = i);
  }
  var init_noise = __esm({
    "src/transcript/noise.ts"() {
      init_dom();
      init_state();
      init_format();
    }
  });

  // src/transcript/parts.ts
  function renderParts() {
    const parts = state.data?.parts || [];
    $("parts-section").classList.toggle("hidden", !(state.server && isReady() && parts.length));
    $("parts").replaceChildren(...parts.map((p, i) => {
      const row = el("div", "part");
      const head = el("div", "part-head");
      head.append(el("span", null, `Segment ${i + 1}`), el("span", "part-meta", `${clockAt(p.start) || fmt(p.start)}\u2013${clockAt(p.end) || fmt(p.end)}`));
      row.append(head, el("div", "part-meta", [plural(p.lines, "line"), p.speakers.slice(0, 3).map(displayName).join(", ")].filter(Boolean).join(" \xB7 ")));
      const act = el("div", "part-actions");
      const jump = el("button", "btn small", "Play");
      jump.type = "button";
      jump.onclick = () => {
        seek(p.start, true);
        closeDrawers();
      };
      const mt2 = el("button", "btn small", "Add to meeting\u2026");
      mt2.type = "button";
      mt2.onclick = () => openMeetingPicker(segmentLines(p), `Segment ${i + 1}`);
      act.append(jump, mt2);
      row.append(act);
      return row;
    }));
  }
  var partIndexAt, segmentLines;
  var init_parts = __esm({
    "src/transcript/parts.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_drawers();
      init_picker();
      init_audio();
      init_elements();
      init_format();
      partIndexAt = (t) => (state.data?.parts || []).findIndex((p) => t >= p.start - 0.01 && t <= p.end + 0.01);
      segmentLines = (p) => state.segments.filter((s) => !s.noise && s.start >= p.start - 0.01 && s.start <= p.end + 0.01);
    }
  });

  // src/transcript/render.ts
  function renderTranscript() {
    const inner = $("transcript-inner");
    const q = $("search").value.trim();
    const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : null;
    const frag = document.createDocumentFragment();
    const timed = sourcesTimed() && state.sources.length > 1 && !state.sources.some((s) => s.file);
    state.matches = [];
    let turn = null, lastSpk = null, lastEnd = -1, lastSrc = -1, shown = 0, lastPart = -1;
    const noiseCount = state.segments.filter((s) => s.noise).length;
    const parts = state.data?.parts || [];
    for (const s of state.segments) {
      if (state.hidden.has(s.speaker) || rx && !s.text.match(rx) || s.noise && !state.showNoise) {
        lastSpk = null;
        continue;
      }
      shown++;
      const pi = partIndexAt(s.start);
      if (state.server && parts.length > 1 && pi >= 0 && pi !== lastPart) {
        const p = parts[pi];
        const d = el("div", "divider part-divider", `Segment ${pi + 1} of ${parts.length} \xB7 ${clockAt(p.start) || fmt(p.start)}\u2013${clockAt(p.end) || fmt(p.end)} \xB7 ${plural(p.lines, "line")}`);
        const add = el("button", "btn small", "Add to meeting\u2026");
        add.type = "button";
        add.title = "Mark every line of this segment as part of a meeting";
        add.onclick = () => openMeetingPicker(segmentLines(p), `Segment ${pi + 1}`);
        d.append(add);
        frag.append(d);
        lastSpk = null;
      }
      if (pi >= 0) lastPart = pi;
      const src = srcIndexAt(s.start);
      if (timed && src !== lastSrc && src >= 0) {
        const r = state.sources[src];
        frag.append(el("div", "divider", `Recording ${src + 1} \xB7 ${clock(r.recorded_at) || fmt(r.start)}`));
        lastSpk = null;
      }
      lastSrc = src;
      if (s.speaker !== lastSpk || s.start - lastEnd > 30) {
        turn = el("div", "turn");
        const av = el("div", "avatar", initials(displayName(s.speaker)));
        av.style.background = state.colors[s.speaker];
        const body = el("div");
        const head = el("div", "turn-head");
        const when = el("span", "when", clockAt(s.start) || fmt(s.start));
        when.title = `${fmt(s.start)} into the day`;
        const who = el("span", "who", displayName(s.speaker));
        if ((state.tvNames || []).includes(s.speaker)) who.append(el("span", "tv-badge", "TV"));
        head.append(who, when);
        body.append(head);
        turn.append(av, body);
        frag.append(turn);
      }
      lastSpk = s.speaker;
      lastEnd = s.end;
      const cue = el("button", "cue");
      cue.dataset.i = String(s.i);
      cue.title = `${clockAt(s.start) || fmt(s.start)}: click to play from here`;
      if (rx) {
        let pos = 0;
        for (const m of s.text.matchAll(rx)) {
          cue.append(document.createTextNode(s.text.slice(pos, m.index)));
          const mk = el("mark", null, m[0]);
          state.matches.push(mk);
          cue.append(mk);
          pos = m.index + m[0].length;
        }
        cue.append(document.createTextNode(s.text.slice(pos)));
      } else {
        cue.append(document.createTextNode(s.text));
      }
      const row = el("div", "cue-row" + (s.noise ? " noise" : ""));
      row.append(cue);
      if (s.noise) cue.append(el("span", "noise-tag", "likely noise"));
      if (s.edited) cue.append(el("span", "edited-tag", "edited"));
      const marked = marksOf(state.date, s.start);
      if (marked.length) cue.append(el("span", "meeting-tag", marked.map((m) => m.name).join(", ")));
      if (s.overlap?.length) {
        const ov2 = el("span", "overlap-tag", `talking over: ${s.overlap.map(displayName).join(", ")}`);
        ov2.title = `${s.overlap.map(displayName).join(" and ")} ${s.overlap.length > 1 ? "were" : "was"} also talking during this line, so some words may be missing or belong to them`;
        cue.append(ov2);
      }
      if (state.server) {
        const pen = el("button", "line-btn edit");
        pen.title = "Edit this line";
        pen.setAttribute("aria-label", "Edit this line");
        pen.append(svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'));
        pen.onclick = () => openEditor(s, row);
        const cut = el("button", "line-btn edit");
        cut.title = "Save this line as an MP3 clip";
        cut.setAttribute("aria-label", "Save this line as an MP3 clip");
        cut.append(svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'));
        cut.onclick = () => saveClip(s, cut);
        const mt2 = el("button", "line-btn mt" + (marked.length ? " on" : ""));
        mt2.title = marked.length ? `In meeting: ${marked.map((m) => m.name).join(", ")}. Click to change` : "Add this line to a meeting";
        mt2.setAttribute("aria-label", "Add this line to a meeting");
        mt2.append(svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M18 8v6M15 11h6"/>'));
        mt2.onclick = () => openMeetingPicker([s], "This line");
        row.append(mt2, cut, pen);
        if (s.noise) {
          const keep = el("button", "line-btn keep");
          keep.title = "Not noise: keep this line";
          keep.setAttribute("aria-label", "Keep this line");
          keep.append(svg('<path d="M20 6 9 17l-5-5"/>'));
          keep.onclick = () => editLines("keep", [s]);
          row.append(keep);
        }
        const del = el("button", "line-btn");
        del.title = "Remove this line (Del)";
        del.setAttribute("aria-label", "Remove this line");
        del.append(svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'));
        del.onclick = () => editLines("trash", [s]);
        row.append(del);
      }
      turn.lastChild.append(row);
    }
    renderNoiseCtl(noiseCount);
    if (!shown) {
      frag.append(el("div", "no-results", state.segments.length ? q ? `No lines match \u201C${q}\u201D on this day.` : noiseCount === state.segments.length ? "Only noise was picked up on this day." : "All speakers are hidden." : "No speech was detected in these recordings."));
    }
    inner.replaceChildren(frag);
    state.matchIdx = -1;
    $("search-count").textContent = q ? `${state.matches.length} match${state.matches.length === 1 ? "" : "es"}` : "";
    state.activeIdx = -1;
    syncActive(true);
  }
  var init_render2 = __esm({
    "src/transcript/render.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_data();
      init_picker();
      init_sync();
      init_edit();
      init_editor();
      init_noise();
      init_parts();
      init_elements();
      init_format();
    }
  });

  // src/speakers/panel.ts
  function renderSpeakers() {
    const talk = {};
    let total = 0;
    for (const s of state.segments) {
      if (s.noise) continue;
      const d = Math.max(0, s.end - s.start);
      talk[s.speaker] = (talk[s.speaker] || 0) + d;
      total += d;
    }
    const list = Object.keys(talk).sort((a, b) => talk[b] - talk[a]);
    $("speakers").replaceChildren(...list.map((spk) => {
      const wrap = el("div", "speaker-row");
      const b = el("button", "speaker" + (state.hidden.has(spk) ? " off" : ""));
      b.title = `${displayName(spk)}: ${fmtDur(talk[spk])} talking. Click to hide/show, double-click to rename everywhere`;
      const dot = el("span", "dot");
      dot.style.background = state.colors[spk];
      const exact = total ? talk[spk] / total * 100 : 0;
      const pct = Math.round(exact);
      const bar = el("span", "bar");
      const fill = el("i");
      fill.style.width = (talk[spk] > 0 ? Math.max(exact, 2) : 0) + "%";
      fill.style.background = state.colors[spk];
      bar.append(fill);
      b.append(dot, el("span", "name", displayName(spk)), el("span", "pct", pct || talk[spk] <= 0 ? pct + "%" : "<1%"), el("span"), bar);
      let clickTimer;
      b.onclick = () => {
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
          state.hidden.has(spk) ? state.hidden.delete(spk) : state.hidden.add(spk);
          if (state.hidden.size === list.length) {
            state.hidden.clear();
            toast("Showing all speakers");
          }
          renderSpeakers();
          renderTranscript();
        }, 220);
      };
      b.ondblclick = () => {
        clearTimeout(clickTimer);
        rename(spk);
      };
      wrap.append(b);
      if (state.server) {
        const p = whoPicker(spk);
        const sp = el("button", "btn small split-btn", "Split\u2026");
        sp.type = "button";
        sp.title = "This voice mixes several people: sort its lines between them";
        sp.onclick = () => openSplit(spk);
        p.append(sp);
        wrap.append(p);
      }
      return wrap;
    }));
  }
  function loadSpeakers() {
    return api("/api/speakers").then((x) => {
      state.allSpeakers = x.speakers;
      state.tvNames = x.tv || [];
    }).catch(() => {
    });
  }
  var init_panel = __esm({
    "src/speakers/panel.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_rename();
      init_who_picker();
      init_render();
      init_render2();
      init_api();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/summary/summary.ts
  async function loadSummary(date) {
    if (!state.server || !date) {
      $("summary-wrap").replaceChildren();
      return;
    }
    let r;
    try {
      r = await api(`/api/days/${date}/summary`);
    } catch {
      return;
    }
    if (state.date !== date) return;
    const wasBusy = state.summary?.date === date && ["queued", "running"].includes(state.summary.status);
    state.summary = { ...r, date };
    renderSummary();
    clearTimeout(state.summaryTimer);
    if (["queued", "running"].includes(r.status)) state.summaryTimer = setTimeout(() => loadSummary(date), 2500);
    else if (wasBusy && r.status === "ready") toast("Summary ready");
    else if (wasBusy && r.status === "failed") toast("The summary didn\u2019t work; see the message above the transcript");
  }
  async function startSummary() {
    const date = state.date;
    try {
      await api(`/api/days/${date}/summary`, { method: "POST" });
    } catch (e) {
      toast(e.message);
      return;
    }
    store.set("summaryOpen", true);
    loadSummary(date);
  }
  function renderSummary() {
    const wrap = $("summary-wrap");
    const r = state.summary;
    if (!state.server || !isReady() || !r || r.date !== state.date) {
      wrap.replaceChildren();
      return;
    }
    const open = store.get("summaryOpen", true);
    const box = el("section", "summary" + (open ? "" : " collapsed"));
    const head = el("div", "summary-head");
    const h = el("h3");
    h.append(svg('<path d="M4 6h16M4 12h10M4 18h13"/>'), "Summary");
    const when = r.created ? new Date(r.created * 1e3).toLocaleString(void 0, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    head.append(h, el("span", "meta", r.status === "ready" ? `${r.model} \xB7 ${when}` : r.model || ""));
    const busy = ["queued", "running"].includes(r.status);
    if (r.status === "ready" && !busy) {
      const copy = el("button", "btn small", "Copy");
      copy.title = "Copy the summary as Markdown";
      copy.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(withTimes(r.markdown, r.refs)).then(() => toast("Summary copied"));
      };
      const again = el("button", "btn small", "Regenerate");
      again.onclick = (e) => {
        e.stopPropagation();
        startSummary();
      };
      head.append(copy, again);
    }
    const chev = el("button", "icon-btn");
    chev.append(svg('<path d="m6 9 6 6 6-6"/>', "chev"));
    chev.title = open ? "Collapse" : "Expand";
    chev.setAttribute("aria-label", chev.title);
    head.append(chev);
    head.style.cursor = "pointer";
    head.onclick = () => {
      store.set("summaryOpen", !open);
      renderSummary();
    };
    box.append(head);
    const body = el("div", "summary-body");
    if (busy) {
      body.append(
        progressBar(r.progress || 0, (r.label || "Waiting") + "\u2026", r.progress ? `${Math.round(r.progress * 100)}%` : ""),
        el("p", "note", "Runs on this computer with Ollama. A long day takes a few minutes; you can keep listening meanwhile.")
      );
    } else if (r.status === "failed") {
      const a = el("div", "actions");
      a.append(btn("Try again", "primary small", startSummary));
      body.append(el("div", "error-box", r.error || "Something went wrong"), a);
    } else if (r.status === "ready") {
      if (r.outdated) {
        const st = el("div", "stale");
        st.append(el("span", null, "The transcript has changed since this summary was written."), btn("Regenerate", "small", startSummary));
        body.append(st);
      }
      body.append(renderMarkdown(r.markdown, r.refs || {}));
    } else {
      body.append(el("p", "lead", `Overview, conversations, shopping list, project ideas, to-dos and key facts for this day, written by ${r.model} on this computer.`));
      const a = el("div", "actions");
      a.append(btn("Summarize this day", "primary", startSummary));
      body.append(a);
    }
    box.append(body);
    wrap.replaceChildren(box);
  }
  var withTimes;
  var init_summary = __esm({
    "src/summary/summary.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_widgets();
      init_markdown();
      init_api();
      init_elements();
      init_format();
      init_store();
      init_toast();
      withTimes = (md, refs) => md.replace(/\[(L\d+(?:\s*[-–,]\s*L?\d+)*)\]/g, (m, list) => "(" + list.split(/\s*,\s*/).map((part) => part.split(/\s*[-–]\s*/).map((x) => "L" + x.replace(/^L/, "")).map((r) => refs[r] !== void 0 ? clockAt(refs[r]) || fmt(refs[r]) : r).join("\u2013")).join(", ") + ")");
    }
  });

  // src/transcript/edit.ts
  async function saveClip(s, btn2) {
    btn2.disabled = true;
    try {
      const r = await api(`/api/days/${state.date}/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: s.start, end: s.end, text: s.text })
      });
      toast(`Clip saved (${r.seconds}s): ${r.path}`);
    } catch (e) {
      toast(e.message);
    }
    btn2.disabled = false;
  }
  async function replaceLines(old, neu, msg) {
    const date = state.date;
    const oldC = old.map(plainLine), newC = neu.map(plainLine);
    const gone = new Set(old);
    state.segments = state.segments.filter((x) => !gone.has(x)).concat(newC.map((x) => ({ ...x }))).sort((a, b) => a.start - b.start);
    for (const x of newC) if (!state.colors[x.speaker]) state.colors[x.speaker] = PALETTE[Object.keys(state.colors).length % PALETTE.length];
    reindex();
    state.editing = null;
    renderSpeakers();
    renderTranscript();
    renderTimeline();
    renderStats();
    const post = (from, to) => api(`/api/days/${date}/lines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "replace", items: from.map((x) => ({ start: x.start, text: x.text })), new: to })
    });
    try {
      await post(oldC, newC);
      loadSummary(date);
    } catch (e) {
      toast(`Couldn't save that: ${e.message}`);
      if (state.date === date) openDay(date, { keepPosition: true });
      return;
    }
    toast(msg, { action: "Undo", onAction: async () => {
      try {
        await post(newC, oldC);
      } catch (e) {
        toast(e.message);
        return;
      }
      if (state.date === date) await openDay(date, { keepPosition: true });
      toast("Undone");
      refreshLibrary();
    } });
    refreshLibrary();
  }
  async function editLines(action, segs) {
    if (!segs.length || !state.server) return;
    const date = state.date;
    const items = segs.map((s) => ({ start: s.start, text: s.text }));
    if (action === "trash") {
      const gone = new Set(segs);
      state.segments = state.segments.filter((s) => !gone.has(s));
      reindex();
    } else segs.forEach((s) => delete s.noise);
    renderSpeakers();
    renderTranscript();
    renderTimeline();
    renderStats();
    const post = (act) => api(`/api/days/${date}/lines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: act, items })
    });
    try {
      await post(action);
      loadSummary(date);
    } catch (e) {
      toast(`Couldn't save that: ${e.message}`);
      if (state.date === date) openDay(date, { keepPosition: true });
      return;
    }
    if (action === "trash") {
      toast(segs.length > 1 ? `${segs.length} lines removed` : "Line removed", {
        action: "Undo",
        onAction: async () => {
          try {
            await post("restore");
          } catch (e) {
            toast(e.message);
            return;
          }
          if (state.date === date) await openDay(date, { keepPosition: true });
          toast(segs.length > 1 ? "Lines restored" : "Line restored");
          refreshLibrary();
        }
      });
    } else toast("Kept as speech");
    refreshLibrary();
  }
  var plainLine;
  var init_edit = __esm({
    "src/transcript/edit.ts"() {
      init_dom();
      init_state();
      init_open();
      init_stats();
      init_library();
      init_timeline();
      init_panel();
      init_summary();
      init_noise();
      init_render2();
      init_api();
      init_toast();
      plainLine = (x) => ({ start: x.start, end: x.end, speaker: x.speaker, text: x.text, ...x.edited ? { edited: true } : {} });
    }
  });

  // src/teach/dialog.ts
  function openTeach() {
    if (!state.server || !isReady()) return;
    const items = teachItems();
    const byPerson = {};
    for (const it of items) (byPerson[it.person] ||= []).push(it);
    teach.stage = "learn";
    teach.groups = Object.entries(byPerson).map(([person, its]) => {
      const card2 = el("div", "vr");
      const head = el("div", "vr-head");
      const dot = el("span", "dot");
      dot.style.background = state.colors[person] || "var(--muted)";
      head.append(dot, el("span", "nm", displayName(person)), el("span", "meta", plural(its.length, "line") + " moved to them"));
      card2.append(head, el("div", "vr-sect", "Learn their voice from these lines"));
      const list = el("div", "vr-snips");
      const rows = its.map((it) => {
        const seg = state.segments.find((s) => sameLine(s, it)) || it;
        const short = seg.end - seg.start < TEACH_MIN;
        const stillThem = seg.speaker === void 0 || seg.speaker === person;
        const r = teachRow(seg, {
          checked: true,
          disabled: short || !stillThem,
          note: short ? "too short to learn from" : !stillThem ? `now ${displayName(seg.speaker)}` : `${(seg.end - seg.start).toFixed(1)}s`
        });
        list.append(r);
        return r;
      });
      card2.append(list);
      return { person, rows, card: card2, sugg: [] };
    });
    $("teach-title").textContent = `Teach voices \xB7 ${shortDate(state.date)}`;
    $("teach-intro").textContent = "Ticked lines are added to each person\u2019s voice profile, so new days recognise them. Next, you\u2019ll see other lines from this day that sound like them.";
    $("teach-list").replaceChildren(...teach.groups.map((g) => g.card));
    $("teach-go").textContent = "Teach and find similar lines";
    $("teach-go").disabled = false;
    $("teach-dlg").showModal();
  }
  async function teachGo() {
    const go2 = $("teach-go");
    const date = state.date;
    if (teach.stage === "learn") {
      go2.disabled = true;
      go2.textContent = "Teaching\u2026 (first time loads the voice model)";
      const taught = [];
      for (const g of teach.groups) {
        const lines = g.rows.filter((r) => r.cb.checked).map((r) => ({ start: r.seg.start, text: r.seg.text }));
        if (!lines.length) continue;
        try {
          const r = await api(`/api/days/${date}/voice-train`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ person: g.person, lines })
          });
          if (r.trained.length) taught.push({ person: g.person, lines: r.trained });
        } catch (e) {
          toast(e.message);
          go2.disabled = false;
          go2.textContent = "Try again";
          return;
        }
      }
      store.set(teachKey(date), []);
      renderTeachTray();
      if (taught.length) toast(`Taught ${taught.map((t) => `${displayName(t.person)} (${plural(t.lines.length, "line")})`).join(", ")}`, { action: "Undo", onAction: async () => {
        for (const t of taught) {
          try {
            await api(`/api/days/${date}/voice-train`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ person: t.person, lines: t.lines, remove: true })
            });
          } catch (e) {
            toast(e.message);
            return;
          }
        }
        toast("Voice teaching undone");
      } });
      teach.stage = "similar";
      go2.textContent = "Looking for similar lines\u2026";
      for (const g of teach.groups) {
        g.card.querySelectorAll(".vr-sect, .vr-snips").forEach((n2) => n2.remove());
        g.card.append(el("div", "vr-sect", `Other lines that sound like ${displayName(g.person)}`));
        const list = el("div", "vr-snips");
        list.append(el("div", "note", "Listening\u2026"));
        g.card.append(list);
        let found = [];
        try {
          found = (await api(`/api/days/${date}/voice-similar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ person: g.person })
          })).lines;
        } catch (e) {
          list.replaceChildren(el("div", "note", e.message));
          continue;
        }
        g.sugg = found.map((f) => {
          const seg = state.segments.find((s) => sameLine(s, f));
          return seg && teachRow(seg, {
            checked: f.strong,
            cls: "tl-score",
            note: `${Math.round(f.score * 100)}% \xB7 now ${displayName(seg.speaker)}`
          });
        }).filter(Boolean);
        list.replaceChildren(...g.sugg.length ? g.sugg : [el("div", "note", "No other lines on this day sound clearly like them.")]);
      }
      const n = teach.groups.reduce((a, g) => a + g.sugg.length, 0);
      $("teach-intro").textContent = n ? "Play any line to check. Strong matches are ticked; ticked lines move to that person (this day only)." : "Done. Nothing else on this day sounds clearly like them.";
      go2.disabled = false;
      go2.textContent = n ? "Move ticked lines" : "Close";
      return;
    }
    stopSnip();
    const old = [], neu = [];
    for (const g of teach.groups) for (const r of g.sugg) {
      if (r.cb.checked && !old.includes(r.seg)) {
        old.push(r.seg);
        neu.push({ ...r.seg, speaker: g.person, edited: true });
      }
    }
    $("teach-dlg").close();
    if (old.length) replaceLines(old, neu, `Moved ${plural(old.length, "line")}`);
  }
  function init6() {
    $("teach-go").addEventListener("click", teachGo);
    $("teach-dlg").addEventListener("close", stopSnip);
    $("teach-later").addEventListener("click", stopSnip);
  }
  var teach;
  var init_dialog3 = __esm({
    "src/teach/dialog.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_snippets();
      init_tray();
      init_edit();
      init_api();
      init_elements();
      init_format();
      init_store();
      init_toast();
      teach = { stage: "learn", groups: [] };
    }
  });

  // src/teach/tray.ts
  function addToTeach(item) {
    const date = state.date;
    const items = teachItems(date).filter((x) => Math.abs(x.start - item.start) >= 0.02);
    if (!item.person.startsWith("Unknown")) items.push(item);
    store.set(teachKey(date), items);
    renderTeachTray();
  }
  function renderTeachTray() {
    const tray = $("teach-tray");
    const items = state.view === "day" ? teachItems() : [];
    tray.classList.toggle("hidden", !items.length);
    if (!items.length) {
      tray.replaceChildren();
      return;
    }
    const people = [...new Set(items.map((x2) => x2.person))];
    const open = btn("Teach voices\u2026", "small primary", () => openTeach());
    open.type = "button";
    const x = el("button", "x", "\xD7");
    x.type = "button";
    x.title = "Forget these moved lines (nothing is taught)";
    x.setAttribute("aria-label", x.title);
    x.onclick = () => {
      store.set(teachKey(state.date), []);
      renderTeachTray();
    };
    tray.replaceChildren(el("span", null, `${plural(items.length, "line")} moved to ${people.map(displayName).join(", ")}`), open, x);
  }
  function teachRow(seg, { checked, disabled, note, cls }) {
    const row = el("label", "tl-row" + (disabled ? " off" : ""));
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = checked && !disabled;
    cb.disabled = disabled;
    const b = el("button", "vr-snip");
    b.type = "button";
    b.title = "Play this line";
    b.append(svg(ICONS.play), el("span", "tm", clockAt(seg.start) || fmt(seg.start)), el("span", "tx", seg.text));
    b.onclick = (e) => {
      e.preventDefault();
      playSnip(seg, b);
    };
    row.append(cb, b);
    if (note) row.append(el("span", cls || "tl-why", note));
    row.cb = cb;
    row.seg = seg;
    return row;
  }
  var TEACH_MIN, teachKey, teachItems, sameLine;
  var init_tray = __esm({
    "src/teach/tray.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_widgets();
      init_snippets();
      init_dialog3();
      init_elements();
      init_format();
      init_store();
      TEACH_MIN = 2;
      teachKey = (date) => "teach:" + date;
      teachItems = (date = state.date) => date ? store.get(teachKey(date), []) : [];
      sameLine = (a, b) => Math.abs(a.start - b.start) < 0.02 && a.text === b.text;
    }
  });

  // src/meetings/page.ts
  async function showMeetings(open = null) {
    if (state.view === "day") savePosition();
    state.view = "meetings";
    state.date = null;
    renderTeachTray();
    state.openToken++;
    audio.pause();
    mt.open = open;
    $("app").classList.add("is-home");
    $("title").textContent = "Meetings";
    document.title = "Meetings \xB7 Recorder Playback";
    $("subtitle").textContent = "";
    closeDrawers();
    renderLibrary();
    updateNav();
    $("home").scrollTop = 0;
    $("home-inner").replaceChildren(el("div", "note", "Loading meetings\u2026"));
    await loadMeetingsPage();
  }
  async function loadMeetingsPage() {
    clearTimeout(mt.timer);
    const open = mt.open;
    try {
      if (open) mt.detail = await api(`/api/meetings/${open}`);
      else await loadMeetings();
    } catch (e) {
      if (state.view !== "meetings") return;
      if (e.status === 404) {
        mt.open = null;
        return loadMeetingsPage();
      }
      $("home-inner").replaceChildren(el("div", "error-box", `Couldn\u2019t load meetings: ${e.message}`));
      return;
    }
    if (state.view !== "meetings" || mt.open !== open) return;
    renderMeetings();
    if (open && ["queued", "running"].includes(mt.detail.summary_state.status)) mt.timer = setTimeout(loadMeetingsPage, 2500);
  }
  function renderMeetings() {
    const inner = $("home-inner");
    if (mt.open) {
      renderMeetingDetail(inner);
      return;
    }
    const ms = state.meetings || [];
    $("subtitle").textContent = plural(ms.length, "meeting");
    const frag = document.createDocumentFragment();
    const head = el("div");
    head.append(
      el("h2", "hello", "Meetings"),
      el("p", "lead", "Mark lines or whole segments of a day as part of a meeting (use the add-person button on a line, or \u201CAdd to meeting\u201D on a segment). Open a meeting for its summary and status.")
    );
    frag.append(head);
    if (!ms.length) {
      const c = card("cal", "No meetings yet");
      c.append(el("p", null, "Open a day, then use \u201CAdd to meeting\u2026\u201D on a segment or the add-person button beside a line."));
      frag.append(c);
    }
    for (const m of ms) {
      const c = el("section", "card mt-card");
      const top = el("div", "mt-top");
      const h = el("h3", null, m.name);
      h.onclick = () => showMeetings(m.id);
      top.append(h);
      top.append(el("span", "chip " + (m.summary ? m.summary.outdated ? "pending" : "new" : ""), m.summary ? m.summary.outdated ? "Summary outdated" : "Summary ready" : "No summary"));
      top.append(btn("Open", "small", () => showMeetings(m.id)));
      c.append(top, meetingStats(m));
      if (m.people.length) {
        const who = el("div");
        m.people.slice(0, 6).forEach((p) => who.append(el("span", "ov-person", `${displayName(p.name)} \xB7 ${fmtDur(p.seconds)}`)));
        c.append(who);
      }
      if (m.summary?.overview) c.append(el("div", "mt-overview", m.summary.overview));
      frag.append(c);
    }
    inner.replaceChildren(frag);
  }
  var init_page = __esm({
    "src/meetings/page.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_drawers();
      init_widgets();
      init_library();
      init_data();
      init_detail();
      init_audio();
      init_tray();
      init_api();
      init_elements();
      init_format();
    }
  });

  // src/overview/table.ts
  function renderOverviewTable() {
    const done = store.get("ovDone", {});
    const words = ov.q.toLowerCase().split(/\s+/).filter(Boolean);
    const all = overviewRows();
    const base = all.filter((r) => {
      if (ov.person && !r.people.includes(ov.person)) return false;
      if (ov.hideDone && r.kind === "task" && done[taskKey(r)]) return false;
      const hay = [r.text, KINDS[r.kind], r.date, shortDate(r.date), ...r.people.map(displayName)].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const counts = {};
    base.forEach((r) => {
      counts[r.kind] = (counts[r.kind] || 0) + 1;
    });
    if (ov.kind && !counts[ov.kind] && !all.some((r) => r.kind === ov.kind)) ov.kind = "";
    ov.tabs.replaceChildren();
    [["", "All", base.length], ...Object.entries(KINDS).filter(([k]) => all.some((r) => r.kind === k)).map(([k, l]) => [k, l, counts[k] || 0])].forEach(([k, l, n]) => {
      const t = el("button", "ov-tab" + (ov.kind === k ? " active" : ""));
      t.setAttribute("role", "tab");
      t.setAttribute("aria-selected", String(ov.kind === k));
      t.append(l, el("span", "n", String(n)));
      t.onclick = () => {
        ov.kind = k;
        renderOverviewTable();
      };
      ov.tabs.append(t);
    });
    const rows = ov.kind ? base.filter((r) => r.kind === ov.kind) : base;
    ov.count.textContent = all.length ? rows.length === all.length ? plural(all.length, "item") : `${rows.length} of ${plural(all.length, "item")}` : "";
    if (!rows.length) {
      ov.tableWrap.replaceChildren(el("p", "muted ov-empty", all.length ? "Nothing matches that." : "Nothing extracted yet. It appears here as each day is read."));
      return;
    }
    const grid = el("div", "ov-grid");
    for (const r of rows.slice(0, 600)) {
      const tr = el("div", "ov-card");
      const top = el("div", "ov-card-top");
      if (r.kind === "task") {
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = !!done[taskKey(r)];
        cb.setAttribute("aria-label", "Done");
        cb.onchange = () => {
          const d = store.get("ovDone", {});
          if (cb.checked) d[taskKey(r)] = 1;
          else delete d[taskKey(r)];
          store.set("ovDone", d);
          tr.classList.toggle("ov-done", cb.checked);
          if (ov.hideDone) renderOverviewTable();
        };
        top.append(cb);
        tr.classList.toggle("ov-done", cb.checked);
      }
      const db = el("button", "pday-date", shortDate(r.date));
      db.onclick = () => go(r.date);
      if (!ov.kind) top.append(el("span", `ov-kind k-${r.kind}`, KINDS[r.kind]));
      top.append(db);
      const text = el("div", "ov-text", r.text);
      const who = el("div", "ov-card-people");
      r.people.forEach((n) => {
        const b = el("button", "ov-person", displayName(n));
        b.onclick = () => {
          ov.person = n;
          ov.personSel.value = n;
          renderOverviewTable();
        };
        who.append(b);
      });
      if (r.start !== void 0) {
        const b = el("button", "prec", r.at);
        b.title = "Hear this moment";
        b.onclick = () => go(r.date, r.start);
        top.append(b);
      }
      tr.append(top, text, who);
      grid.append(tr);
    }
    ov.tableWrap.replaceChildren(grid);
    if (rows.length > 600) ov.tableWrap.append(el("p", "muted ov-empty", "Showing the newest 600. Search or filter to narrow it."));
  }
  var init_table = __esm({
    "src/overview/table.ts"() {
      init_helpers();
      init_library();
      init_data2();
      init_elements();
      init_format();
      init_store();
    }
  });

  // src/overview/render.ts
  function renderOverview() {
    const days = state.overview.days;
    const inner = $("home-inner");
    if (!ov.built) {
      ov.built = true;
      const head = el("div");
      head.append(
        el("h2", "hello", "Overview"),
        el("p", "lead", "Memories, interactions, to-dos and plans pulled out of your last 30 days, and who you saw each day. Search or filter the table; click a time to hear it.")
      );
      ov.status = el("div");
      ov.filters = el("div", "ov-filters");
      const q = el("input");
      q.type = "search";
      q.placeholder = "Search everything\u2026";
      q.setAttribute("aria-label", "Search the overview");
      q.oninput = () => {
        ov.q = q.value;
        renderOverviewTable();
      };
      ov.tabs = el("div", "ov-tabs");
      ov.tabs.setAttribute("role", "tablist");
      ov.personSel = el("select");
      ov.personSel.setAttribute("aria-label", "Person");
      ov.personSel.onchange = () => {
        ov.person = ov.personSel.value;
        renderOverviewTable();
      };
      const done = el("label", "ov-check");
      const cb = el("input");
      cb.type = "checkbox";
      cb.onchange = () => {
        ov.hideDone = cb.checked;
        renderOverviewTable();
      };
      done.append(cb, " Hide finished to-dos");
      ov.filters.append(q, ov.personSel, done);
      ov.count = el("div", "ov-count");
      ov.tableWrap = el("div", "ov-tablewrap");
      ov.saw = el("div");
      inner.classList.add("ov-wide");
      inner.replaceChildren(head, ov.status, ov.tabs, ov.filters, ov.count, ov.tableWrap, ov.saw);
    }
    const x = state.overview.extractor;
    const errs = Object.entries(x.errors);
    ov.status.replaceChildren();
    if (x.current || x.queued.length) {
      const cur = x.current;
      const box = card("spin", "Reading your days\u2026");
      box.append(el("p", null, `${cur ? `${shortDate(cur.date)}: ${cur.label}` : "Waiting"}${x.queued.length ? ` \xB7 ${plural(x.queued.length, "more day")} waiting` : ""}`));
      const bar = el("div", "bar-mini");
      const fill = el("i");
      fill.style.width = `${Math.round((cur?.progress || 0) * 100)}%`;
      bar.append(fill);
      box.append(bar);
      ov.status.append(box);
    }
    if (errs.length) {
      const box = card("alert", `Couldn\u2019t read ${plural(errs.length, "day")}`);
      box.classList.add("attention");
      box.append(el("p", null, String(errs[0][1])));
      const act = el("div", "actions");
      const b = el("button", "btn small", "Try again");
      b.onclick = async () => {
        try {
          await api("/api/overview/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retry: true }) });
        } catch (e) {
          toast(e.message);
        }
        loadOverview();
      };
      act.append(b);
      box.append(act);
      ov.status.append(box);
    }
    const names = [...new Set(overviewRows().flatMap((r) => r.people))].sort((a, b) => displayName(a).localeCompare(displayName(b)));
    ov.personSel.replaceChildren();
    [["", "Everyone"], ...names.map((n) => [n, displayName(n)])].forEach(([v, l]) => {
      const o = el("option", null, l);
      o.value = v;
      ov.personSel.append(o);
    });
    ov.personSel.value = names.includes(ov.person) ? ov.person : ov.person = "";
    renderOverviewTable();
    const saw = el("div", "card");
    saw.append(el("h3", null, "Who I saw each day"));
    const list = el("div", "person-days");
    for (const d of days) {
      const row = el("div", "pday");
      const dl = el("button", "pday-date", shortDate(d.date));
      dl.title = `Open ${longDate(d.date)}`;
      dl.onclick = () => go(d.date);
      const recs = el("div", "precs");
      if (!d.speakers.length) recs.append(el("span", "muted", "No one identified"));
      for (const p of d.speakers) {
        const b = el("button", "prec");
        b.append(el("b", null, displayName(p.name)), el("span", null, ` ${fmtDur(p.seconds)}`));
        b.title = `Open ${shortDate(d.date)} where ${displayName(p.name)} first speaks`;
        b.onclick = () => go(d.date, p.first_line);
        recs.append(b);
      }
      row.append(dl, recs);
      list.append(row);
    }
    if (!days.length) list.append(el("p", "muted", "No transcribed days in this window yet."));
    saw.append(list);
    ov.saw.replaceChildren(saw);
  }
  var init_render3 = __esm({
    "src/overview/render.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_widgets();
      init_library();
      init_data2();
      init_table();
      init_api();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/overview/data.ts
  async function showOverview() {
    if (state.view === "day") savePosition();
    state.view = "overview";
    state.date = null;
    renderTeachTray();
    state.openToken++;
    audio.pause();
    $("app").classList.add("is-home");
    $("title").textContent = "Overview";
    document.title = "Overview \xB7 Recorder Playback";
    closeDrawers();
    renderLibrary();
    updateNav();
    $("home").scrollTop = 0;
    ov.built = false;
    $("home-inner").replaceChildren(el("div", "note", "Gathering the last 30 days\u2026"));
    await loadOverview();
    try {
      await api("/api/overview/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch {
    }
    loadOverview();
  }
  async function loadOverview() {
    clearTimeout(ov.timer);
    try {
      state.overview = await api("/api/overview");
    } catch (e) {
      if (state.view === "overview") $("home-inner").replaceChildren(el("div", "error-box", `Couldn\u2019t load the overview: ${e.message}`));
      return;
    }
    if (state.view !== "overview") return;
    renderOverview();
    const x = state.overview.extractor;
    if (x.current || x.queued.length) ov.timer = setTimeout(() => {
      if (state.view === "overview") loadOverview();
    }, 4e3);
  }
  function overviewRows() {
    const rows = [];
    for (const d of state.overview.days) for (const it of d.items) rows.push({ ...it, date: d.date });
    rows.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (a.start ?? 1e9) - (b.start ?? 1e9));
    return rows;
  }
  var KINDS, ov, taskKey;
  var init_data2 = __esm({
    "src/overview/data.ts"() {
      init_dom();
      init_state();
      init_drawers();
      init_library();
      init_render3();
      init_audio();
      init_tray();
      init_api();
      init_elements();
      KINDS = { fact: "Memory", interaction: "Interaction", task: "To-do", shopping: "Shopping", idea: "Idea", decision: "Decision", plan: "Plan" };
      ov = { q: "", kind: "", person: "", hideDone: false, built: false, timer: null };
      taskKey = (r) => `${r.date}|${r.text}`;
    }
  });

  // src/people/profiles.ts
  function profileSection(name, prof, isTv) {
    const box = el("details", "vprof");
    const prints = prof?.prints || [];
    box.append(el("summary", null, prints.length ? `Voice profile \xB7 ${plural(prints.length, "sample")}` : "Voice profile \xB7 no samples (not recognised by voice)"));
    const post = (url, body, method = "POST") => api(url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    const reload = (n) => showPeople(n);
    for (const pr of prints) {
      const row = el("div", "vprint");
      const top = el("div", "row");
      const when = pr.day === "legacy" ? "Old sample (from before per-day samples)" : pr.day === "lines" ? "Taught from lines" : shortDate(pr.day);
      top.append(
        el("b", null, when),
        el("span", "muted", [
          pr.label === "lines" ? "taught from single lines" : pr.seconds ? `${fmtDur(pr.seconds)} of speech` : "",
          pr.heard_as && pr.heard_as !== name ? `heard as ${displayName(pr.heard_as)} that day` : ""
        ].filter(Boolean).join(" \xB7 ")),
        el("span", "grow")
      );
      if (pr.day && pr.day !== "legacy") {
        const o = el("button", "btn small", "Open day");
        o.onclick = () => go(pr.day);
        top.append(o);
      }
      const rm = el("button", "btn small", "Remove sample");
      rm.title = "This sample is the wrong voice: stop using it to recognise them";
      rm.onclick = async () => {
        if (rm.dataset.sure !== "1") {
          rm.dataset.sure = "1";
          rm.textContent = "Click again to remove";
          return;
        }
        try {
          await post(`/api/voices/prints/${pr.id}`, null, "DELETE");
        } catch (e) {
          toast(e.message);
          return;
        }
        toast(`Removed a sample from ${displayName(name)}`);
        reload(name);
      };
      top.append(rm);
      row.append(top);
      for (const s of pr.samples || []) {
        const b = el("button", "vr-snip");
        b.type = "button";
        b.append(svg(ICONS.play), el("span", null, s.text));
        b.title = "Play this line";
        b.onclick = () => playSnip(s, b, pr.audio);
        row.append(b);
      }
      if (pr.day !== "legacy" && !(pr.samples || []).length) row.append(el("p", "muted", "No clean lines to play from this day."));
      box.append(row);
    }
    const act = el("div", "vprof-actions");
    const rename2 = el("input");
    rename2.placeholder = "New name, then Enter";
    rename2.value = "";
    rename2.onkeydown = async (e) => {
      if (e.key !== "Enter" || !rename2.value.trim()) return;
      const to = rename2.value.trim();
      try {
        await post("/api/speakers/rename", { old: name, new: to, merge: false });
      } catch (err) {
        toast(err.message.includes("409") || /exists|taken/i.test(err.message) ? `${to} already exists: use Merge instead` : err.message);
        return;
      }
      toast(`Renamed to ${to} everywhere`);
      reload(to);
    };
    const merge = el("select");
    const m0 = el("option", null, "Merge into\u2026");
    m0.value = "";
    merge.append(m0);
    (state.profiles || []).map((v) => v.name).concat((state.people || []).map((p) => p.name)).filter((n, i, a) => n !== name && a.indexOf(n) === i).sort((a, b) => a.localeCompare(b)).forEach((n) => {
      const o = el("option", null, displayName(n));
      o.value = n;
      merge.append(o);
    });
    merge.onchange = async () => {
      const to = merge.value;
      if (!to) return;
      const ok = el("button", "btn small primary", `Merge ${displayName(name)} into ${displayName(to)}`);
      ok.onclick = async () => {
        try {
          await post("/api/speakers/rename", { old: name, new: to, merge: true });
        } catch (e) {
          toast(e.message);
          return;
        }
        toast(`${displayName(name)} merged into ${displayName(to)} on every day`);
        reload(to);
      };
      act.querySelector(".merge-ok")?.remove();
      ok.classList.add("merge-ok");
      merge.after(ok);
    };
    const kind = el("button", "btn small", isTv ? "Not TV: a person" : "Mark as TV / YouTube");
    kind.title = isTv ? "Count them as a person again (shows in \u201Cwho I saw\u201D and talk time)" : "A YouTuber or show: still transcribed and summarised, but not counted as someone you saw";
    kind.onclick = async () => {
      try {
        await post("/api/voices/kind", { name, tv: !isTv });
      } catch (e) {
        toast(e.message);
        return;
      }
      toast(isTv ? `${displayName(name)} is a person` : `${displayName(name)} is TV / YouTube`);
      reload(name);
    };
    act.append(rename2, merge, kind);
    if (prof) {
      const del = el("button", "btn small danger", "Delete profile");
      del.title = "Forget this voice. Lines in transcripts keep the name; new days won\u2019t recognise it.";
      del.onclick = async () => {
        if (del.dataset.sure !== "1") {
          del.dataset.sure = "1";
          del.textContent = "Click again to delete";
          return;
        }
        try {
          await post("/api/voices/delete", { name });
        } catch (e) {
          toast(e.message);
          return;
        }
        toast(`Deleted ${displayName(name)}\u2019s voice profile`);
        reload();
      };
      act.append(del);
    }
    box.append(act);
    return box;
  }
  var init_profiles = __esm({
    "src/people/profiles.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_library();
      init_page2();
      init_snippets();
      init_api();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/people/page.ts
  async function showPeople(focus) {
    if (state.view === "day") savePosition();
    state.view = "people";
    state.date = null;
    renderTeachTray();
    state.openToken++;
    audio.pause();
    $("app").classList.add("is-home");
    $("title").textContent = "People";
    document.title = "People \xB7 Recorder Playback";
    closeDrawers();
    renderLibrary();
    updateNav();
    $("home").scrollTop = 0;
    $("home-inner").replaceChildren(el("div", "note", "Gathering everyone from your transcripts\u2026"));
    try {
      const [pp, vv] = await Promise.all([api("/api/people"), api("/api/voices")]);
      state.people = pp.people;
      state.profiles = vv.profiles;
    } catch (e) {
      $("home-inner").replaceChildren(el("div", "error-box", `Couldn't load people: ${e.message}`));
      return;
    }
    if (state.view === "people") renderPeople(focus);
  }
  function renderPeople(focus) {
    const profiles = Object.fromEntries((state.profiles || []).map((v) => [v.name, v]));
    const people = [...(state.people || []).map((p) => ({ ...p, tv: p.tv || !!profiles[p.name]?.tv }))];
    for (const v of state.profiles || []) if (!people.some((p) => p.name === v.name))
      people.push({ name: v.name, tv: v.tv, days: [], recordings: 0, seconds: 0, voiceprints: v.prints.length, profileOnly: true });
    const humans = people.filter((p) => !p.tv), tv = people.filter((p) => p.tv);
    $("subtitle").textContent = `${plural(humans.length, "person")} across your transcripts`.replace("persons", "people");
    const frag = document.createDocumentFragment();
    const head = el("div");
    head.append(
      el("h2", "hello", "People"),
      el("p", "lead", "Everyone named in your transcripts: the recordings they\u2019re in and the days they were heard. Open \u201CVoice profile\u201D to listen to the samples each voice was learned from.")
    );
    frag.append(head);
    if (!people.length) {
      const c = card("mic", "No people yet");
      c.append(el("p", null, "Once a day is transcribed, the voices in it show up here."));
      frag.append(c);
    }
    let i = -1;
    const section = (list, title) => {
      if (list.length && title) frag.append(el("div", "vr-sect", title));
      list.forEach((p) => personCard(p, ++i));
    };
    const personCard = (p, i2) => {
      const c = el("details", "card person");
      c.open = focus ? p.name === focus : i2 < 3 && !p.profileOnly;
      const sum = el("summary");
      const av = el("span", "avatar", initials(displayName(p.name)));
      av.style.background = PALETTE[i2 % PALETTE.length];
      const info = el("span", "person-info");
      info.append(
        el("span", "person-name", displayName(p.name)),
        el("span", "person-meta", p.profileOnly ? `Voice profile only \xB7 ${plural(p.voiceprints, "sample")}, in no transcript` : [
          plural(p.days.length, "day"),
          plural(p.recordings, "recording"),
          `${fmtDur(p.seconds)} ${p.tv ? "heard" : "talking"}`,
          p.days.length > 1 ? `${shortDate(p.first_seen)} \u2013 ${shortDate(p.last_seen)}` : shortDate(p.last_seen)
        ].join(" \xB7 "))
      );
      sum.append(av, info);
      if (p.tv) sum.append(el("span", "chip tv", "TV"));
      if (!p.voiceprints && !p.profileOnly) {
        const tag = el("span", "chip", "name only");
        tag.title = "Named by you on a day; the voice itself is recognised under another name";
        sum.append(tag);
      }
      c.append(sum);
      c.append(profileSection(p.name, profiles[p.name], p.tv));
      if (p.profileOnly) {
        frag.append(c);
        return;
      }
      const secs = Object.fromEntries(p.days.map((d) => [d.date, Math.max(1, Math.round(d.seconds / 60))]));
      const byDate = Object.fromEntries(p.days.map((d) => [d.date, d]));
      const g = heatGrid(secs, {
        title: (k, n) => `${fmtDur(byDate[k].seconds)} talking in ${plural(byDate[k].recordings.length, "recording")}`,
        onClick: (k) => go(k),
        levels: [2, 10, 30]
      });
      c.append(g.wrap);
      const foot = el("div", "heat-foot");
      foot.append(el("span", null, `Seen on ${plural(g.days, "day")} in the last year \xB7 longest run ${plural(g.best, "day")}`), heatLegend());
      c.append(foot);
      const list = el("div", "person-days");
      for (const d of p.days) {
        const row = el("div", "pday");
        const dl = el("button", "pday-date", shortDate(d.date));
        dl.title = `Open ${longDate(d.date)}`;
        dl.onclick = () => go(d.date);
        const recs = el("div", "precs");
        for (const r of d.recordings) {
          const b = el("button", "prec");
          b.append(el("b", null, clock(r.recorded_at) || r.name), el("span", null, ` ${fmtDur(r.seconds)} \xB7 ${plural(r.lines, "line")}`));
          b.title = `Open ${shortDate(d.date)} at ${displayName(p.name)}\u2019s first line in this recording`;
          b.onclick = () => go(d.date, r.first_line);
          recs.append(b);
        }
        row.append(dl, recs);
        list.append(row);
      }
      c.append(list);
      if (p.highlights?.length) {
        const notes = el("div", "person-notes");
        notes.append(el("h4", null, "Recently"));
        for (const h of p.highlights) {
          const row = el("div", "pnote");
          row.append(el("span", `ov-kind k-${h.kind}`, KINDS[h.kind] || h.kind), el("span", null, h.text));
          const b = el("button", "prec", `${shortDate(h.date)}${h.at ? " \xB7 " + h.at : ""}`);
          b.title = "Hear this moment";
          b.onclick = () => go(h.date, h.start);
          row.append(b);
          notes.append(row);
        }
        c.append(notes);
      }
      frag.append(c);
    };
    section(humans, tv.length ? `People \xB7 ${humans.length}` : "");
    section(tv, `TV / YouTube \xB7 ${tv.length}`);
    $("home-inner").replaceChildren(frag);
    if (focus) requestAnimationFrame(() => [...document.querySelectorAll(".person")].find((x) => x.open)?.scrollIntoView({ block: "start" }));
  }
  var init_page2 = __esm({
    "src/people/page.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_drawers();
      init_heat_grid();
      init_widgets();
      init_library();
      init_data2();
      init_profiles();
      init_audio();
      init_tray();
      init_api();
      init_elements();
      init_format();
    }
  });

  // src/day/open.ts
  function showApp() {
    $("empty").classList.add("hidden");
    $("app").classList.remove("hidden");
    renderLibrary();
    const want = decodeURIComponent(location.hash.slice(1));
    if (want === "people" && state.server) showPeople();
    else if (want === "overview" && state.server) showOverview();
    else if (want === "meetings" && state.server) showMeetings();
    else if (want && libItem(want)) openDay(want);
    else {
      history.replaceState(null, "", location.pathname);
      showHome();
    }
  }
  function normalizeSources(src) {
    return (src || []).map((s) => typeof s === "string" ? { name: s, start: null, duration: null, recorded_at: fromName(s), url: null } : { ...s, recorded_at: s.recorded_at || fromName(s.name) });
  }
  async function openDay(date, opts = {}) {
    if (!libItem(date)) return;
    state.view = "day";
    $("app").classList.remove("is-home");
    const token = ++state.openToken;
    let data;
    try {
      data = await api(`/api/days/${encodeURIComponent(date)}`);
    } catch (e) {
      toast(`Couldn't load ${shortDate(date)}: ${e.message}`);
      return;
    }
    if (token !== state.openToken) return;
    api("/api/speakers").then((r) => {
      state.allSpeakers = r.speakers;
      state.tvNames = r.tv || [];
      if (state.date === date && state.view === "day") {
        renderSpeakers();
        if (state.tvNames.length && !state.editing) renderTranscript();
      }
    }).catch(() => {
    });
    const keep = opts.keepPosition && date === state.date;
    if (!keep) savePosition();
    state.date = date;
    state.data = data;
    state.sources = normalizeSources(data.sources);
    state.segments = (data.segments || []).filter((s) => s && typeof s.start === "number").map((s, i) => ({ ...s, i, speaker: s.speaker || "Unknown", text: String(s.text || "") }));
    state.renames = {};
    if (!keep) state.hidden = /* @__PURE__ */ new Set();
    state.activeIdx = -1;
    state.activeSrc = -1;
    closeDrawers();
    state.colors = {};
    const order = libItem(date)?.speakers || [];
    [.../* @__PURE__ */ new Set([...order, ...state.segments.map((s) => s.speaker)])].forEach((s, i) => state.colors[s] = PALETTE[i % PALETTE.length]);
    $("title").textContent = longDate(date);
    document.title = `${shortDate(date)} \xB7 Recorder Playback`;
    renderLibrary();
    updateNav();
    renderTeachTray();
    const ready = isReady();
    $("toolbar").classList.toggle("hidden", !ready);
    $("transcript").classList.toggle("hidden", !ready);
    $("pending").classList.toggle("hidden", ready);
    $("export-btn").disabled = !ready;
    $("spk-section").classList.toggle("hidden", !ready);
    $("redo-section").classList.toggle("hidden", !ready);
    $("rec-section").classList.toggle("hidden", !ready || !state.sources.length || state.sources.some((s) => s.file));
    if (ready) {
      if (!keep) $("search").value = "";
      state.duration = keep && audio.duration || (state.segments.length ? state.segments[state.segments.length - 1].end : 0);
      renderSpeakers();
      renderTranscript();
      renderBanner();
      if (!keep) setAudio(data.audio_url, { resume: true });
    } else {
      $("banner").classList.add("hidden");
      state.rawIdx = -1;
      setAudio(null, { quiet: true });
      state.duration = 0;
      renderPending();
      $("pending").scrollTop = 0;
    }
    renderRecordings();
    renderStats();
    renderParts();
    if (ready && state.server) loadMeetings().then(() => {
      if (state.date !== date || state.view !== "day") return;
      if (!state.editing) renderTranscript();
      renderParts();
    });
    renderTimeline();
    updateProgress();
    updateNow();
    if (ready) {
      if (state.summary?.date !== date) $("summary-wrap").replaceChildren();
      loadSummary(date);
    }
    if (ready && state.server && !keep && data.voices_reviewed === false && !state.reviewSeen.has(date)) openVoiceReview();
    else $("summary-wrap").replaceChildren();
    if (state.pendingSeek != null && isReady()) {
      const t = state.pendingSeek;
      state.pendingSeek = null;
      const jump = () => {
        seek(t);
        document.querySelector(".cue.active")?.scrollIntoView({ block: "center" });
      };
      audio.readyState >= 1 ? jump() : audio.addEventListener("loadedmetadata", jump, { once: true });
    }
  }
  var init_open = __esm({
    "src/day/open.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_pending();
      init_recordings();
      init_stats();
      init_drawers();
      init_home();
      init_library();
      init_data();
      init_page();
      init_data2();
      init_page2();
      init_audio();
      init_sync();
      init_timeline();
      init_dialog2();
      init_panel();
      init_summary();
      init_tray();
      init_parts();
      init_render2();
      init_api();
      init_format();
      init_toast();
    }
  });

  // src/home/sync.ts
  async function refreshSync() {
    try {
      const r = await api("/api/sync");
      const was = state.sync?.job;
      state.sync = r;
      if (was?.running && !r.job.running) {
        if (r.job.error) toast(`Sync stopped: ${r.job.error}`);
        else toast(`${r.mode === "move" ? "Moved" : "Copied"} ${plural(r.job.files_done, "recording")}` + (state.settings?.auto_transcribe ? ". Transcribing now." : ". Press Transcribe when you\u2019re ready."));
        refreshLibrary();
      }
    } catch {
    }
    $("lib-home-dot").classList.toggle("hidden", !(state.sync?.recorders || []).some((r) => r.new > 0));
    if (state.view === "home") renderHome();
    if (state.sync?.job?.running) {
      clearTimeout(state.syncTimer);
      state.syncTimer = setTimeout(refreshSync, 1e3);
    }
  }
  async function startSync(rec) {
    if (state.syncMode === "move" && !confirm(`Move ${plural(rec.new, "recording")} off ${rec.label}? They'll be deleted from the recorder after each copy is checked.`)) return;
    try {
      state.sync.job = await api("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: rec.root }) });
    } catch (e) {
      toast(e.message);
    }
    refreshSync();
  }
  var init_sync2 = __esm({
    "src/home/sync.ts"() {
      init_dom();
      init_state();
      init_home();
      init_library();
      init_api();
      init_format();
      init_toast();
    }
  });

  // src/library/library.ts
  function renderLibrary() {
    const list = $("lib-list");
    const scroll = $("library").scrollTop;
    const frag = document.createDocumentFragment();
    let month = null;
    for (const d of state.library) {
      const m = monthName(d.date);
      if (m !== month) {
        frag.append(el("div", "month", m));
        month = m;
      }
      const card2 = el("button", "day-card" + (d.date === state.date ? " active" : ""));
      card2.dataset.date = d.date;
      const row = el("div", "row");
      row.append(el("span", "dname", shortDate(d.date)));
      const job = d.job;
      if (job?.status === "processing") row.append(el("span", "chip processing", `${Math.round((job.progress || 0) * 100)}%`));
      else if (job?.status === "queued") row.append(el("span", "chip queued", "Queued"));
      else if (job?.status === "failed") row.append(el("span", "chip failed", "Failed"));
      else if (job?.status === "blocked") row.append(el("span", "chip pending", "Needs levels"));
      else if (d.status === "pending") row.append(el("span", "chip pending", "Not transcribed"));
      else if (d.new_recordings) row.append(el("span", "chip new", `+${d.new_recordings} new`));
      card2.append(row);
      const bits = [fmtDur(d.duration)];
      if (d.parts) bits.push(plural(d.parts, "segment"));
      else if (d.recordings) bits.push(plural(d.recordings, "recording"));
      if (d.first_time) bits.push(d.first_time === d.last_time ? clock(d.first_time) : `${clock(d.first_time)}\u2013${clock(d.last_time)}`);
      card2.append(el("div", "meta", job?.status === "processing" ? job.label + "\u2026" : bits.join(" \xB7 ")));
      if (job?.status === "processing") {
        const bar = el("div", "bar-mini");
        const fill = el("i");
        fill.style.width = `${(job.progress || 0) * 100}%`;
        bar.append(fill);
        card2.append(bar);
      } else if (d.speakers?.length) {
        const people = el("div", "people");
        const dots = el("span", "dots");
        d.speakers.slice(0, 4).forEach((s, i) => {
          const dot = el("i");
          dot.style.background = PALETTE[i % PALETTE.length];
          dots.append(dot);
        });
        const names = d.speakers.slice(0, 3).map(displayName).join(", ") + (d.speakers.length > 3 ? ` +${d.speakers.length - 3}` : "");
        people.append(dots, el("span", null, names));
        card2.append(people);
      }
      frag.append(card2);
    }
    if (!state.library.length) frag.append(el("div", "lib-empty", "No recordings yet."));
    list.replaceChildren(frag);
    $("library").scrollTop = scroll;
    const ready = state.library.filter((d) => d.status === "ready").length;
    $("lib-count").textContent = state.library.length ? `${ready}/${state.library.length} transcribed` : "";
    const todo = state.library.filter((d) => d.status === "pending" && !d.job);
    $("lib-actions").classList.toggle("hidden", todo.length < 2);
    $("process-all").textContent = `Transcribe all ${todo.length} days`;
  }
  function renderJobPill() {
    const pill = $("job-pill"), j = state.jobs || {};
    const cur = j.current, waiting = (j.queued || []).length;
    if (j.blocked) {
      pill.classList.remove("hidden");
      pill.classList.add("indeterminate");
      $("job-text").textContent = `Paused \xB7 ${shortDate(j.blocked.date)} needs your levels`;
      pill.title = "A recording looks unusual: click to check it";
      pill.dataset.date = "";
      pill.onclick = () => showBlocked(j.blocked);
      return;
    }
    pill.onclick = () => {
      const d = pill.dataset.date;
      if (d) {
        go(d);
        closeDrawers();
      }
    };
    pill.classList.toggle("hidden", !cur && !waiting);
    if (!cur && !waiting) return;
    const pct = cur?.progress || 0;
    pill.classList.toggle("indeterminate", !cur || !pct);
    $("job-ring").setAttribute("stroke-dashoffset", String(50.27 * (1 - (cur && pct ? pct : 0.25))));
    $("job-text").textContent = cur ? `Transcribing ${shortDate(cur.date)} \xB7 ${pct ? Math.round(pct * 100) + "%" : cur.label}` + (waiting ? ` \xB7 ${waiting} waiting` : "") : `${plural(waiting, "day")} waiting`;
    pill.title = cur ? `${cur.label}\u2026 (click to open ${shortDate(cur.date)})` : "Waiting to start";
    pill.dataset.date = cur?.date || j.queued[0];
  }
  function updateNav() {
    $("lib-home").classList.toggle("active", state.view === "home");
    $("lib-people").classList.toggle("active", state.view === "people");
    $("lib-overview").classList.toggle("active", state.view === "overview");
    $("lib-meetings").classList.toggle("active", state.view === "meetings");
    $("home-inner").classList.toggle("ov-wide", state.view === "overview");
    const i = state.library.findIndex((d) => d.date === state.date);
    $("prev-day").disabled = i < 0 || i >= state.library.length - 1;
    $("next-day").disabled = i <= 0;
  }
  function stepDay(dir) {
    const i = state.library.findIndex((d) => d.date === state.date);
    const target = state.library[i + (dir < 0 ? 1 : -1)];
    if (target) go(target.date);
  }
  function go(date, seekTo) {
    if (!date) {
      if (location.hash) history.pushState(null, "", location.pathname);
      showHome();
      return;
    }
    if (seekTo !== void 0) state.pendingSeek = seekTo;
    if (date === "people") {
      if (location.hash !== "#people") location.hash = "people";
      else showPeople();
      return;
    }
    if (date === "overview") {
      if (location.hash !== "#overview") location.hash = "overview";
      else showOverview();
      return;
    }
    if (date === "meetings") {
      if (location.hash !== "#meetings") location.hash = "meetings";
      else showMeetings();
      return;
    }
    if (location.hash.slice(1) !== date) location.hash = date;
    else openDay(date);
  }
  async function refreshLibrary(quiet = true) {
    if (!state.server) return;
    let r;
    try {
      r = await api("/api/library");
    } catch (e) {
      if (!quiet) toast(`Couldn't reach the server: ${e.message}`);
      schedulePoll(15e3);
      return;
    }
    const prev = Object.fromEntries(state.library.map((d) => [d.date, d]));
    state.library = r.days;
    state.recordDir = r.record_dir;
    state.jobs = r.jobs;
    renderJobPill();
    const b = r.jobs?.blocked;
    if (b && state.blockedFor !== b.date + "|" + b.clips.join(",")) showBlocked(b);
    if (!b && state.blockedFor && $("process-dlg").classList.contains("blocked")) {
      state.blockedFor = null;
      $("process-dlg").close();
    }
    if ($("app").classList.contains("hidden")) {
      showApp();
      schedulePoll(r.busy ? 2500 : 5e3);
      return;
    }
    renderLibrary();
    updateNav();
    for (const d of state.library) {
      const was = prev[d.date];
      const finished = d.status === "ready" && !d.job && (was?.status === "pending" || was?.job && was.job.status !== "failed");
      if (finished) {
        if (d.date === state.date) {
          await openDay(d.date);
          toast("Transcript ready");
        } else toast(`${shortDate(d.date)} is ready`);
      }
      if (was && was.job?.status !== "failed" && d.job?.status === "failed") toast(`Transcribing ${shortDate(d.date)} failed`);
    }
    const cur = libItem(state.date);
    if (cur && !isReady()) renderPending();
    if (cur && isReady()) renderBanner();
    if (!quiet) toast(`Library up to date \xB7 ${plural(state.library.length, "day")}`);
    if (state.view === "home") {
      renderHome();
      if (!state.sync?.job?.running) refreshSync();
    }
    schedulePoll(r.busy ? 2500 : state.view === "home" ? 5e3 : 2e4);
  }
  function schedulePoll(ms) {
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(() => refreshLibrary(), ms);
  }
  var init_library = __esm({
    "src/library/library.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_open();
      init_pending();
      init_stats();
      init_drawers();
      init_home();
      init_sync2();
      init_page();
      init_data2();
      init_page2();
      init_dialog();
      init_api();
      init_elements();
      init_format();
      init_toast();
    }
  });

  // src/home/heat-grid.ts
  function heatGrid(counts, { title, cls, onClick, levels = [1, 3, 6] } = {}) {
    const now = /* @__PURE__ */ new Date();
    now.setHours(0, 0, 0, 0);
    const latest = Object.keys(counts).sort().pop();
    const today = latest && toDate(latest) > now ? toDate(latest) : now;
    const start = new Date(today);
    start.setDate(start.getDate() - 52 * 7 - today.getDay());
    const level = (n) => !n ? 0 : n <= levels[0] ? 1 : n <= levels[1] ? 2 : n <= levels[2] ? 3 : 4;
    const grid = el("div", "heat");
    ["", "Mon", "", "Wed", "", "Fri", ""].forEach((t, i) => {
      const w = el("span", "wd", t);
      w.style.gridRow = String(i + 2);
      grid.append(w);
    });
    let lastMonth = -1, days = 0, total = 0, streak = 0, best = 0;
    for (let w = 0, d = new Date(start); d <= today || d.getDay() !== 0; w++) {
      for (let dow = 0; dow < 7; dow++, d.setDate(d.getDate() + 1)) {
        if (dow === 0 && d.getMonth() !== lastMonth && d.getDate() <= 7) {
          lastMonth = d.getMonth();
          const m = el("span", "mon", d.toLocaleDateString(void 0, { month: "short" }));
          m.style.gridColumn = `${w + 2} / span 3`;
          grid.append(m);
        }
        const key = isoDay(d), n = counts[key] || 0;
        const sq = el("button", `sq l${level(n)}` + (n ? " has" : "") + (n && cls ? " " + cls(key) : "") + (key === isoDay(now) ? " today" : "") + (d > today ? " future" : ""));
        sq.style.gridColumn = String(w + 2);
        sq.style.gridRow = String(dow + 2);
        const when = d.toLocaleDateString(void 0, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
        sq.title = n ? `${when}: ${title(key, n)}` : `${when}: nothing`;
        sq.setAttribute("aria-label", sq.title);
        if (n && onClick) sq.onclick = () => onClick(key);
        else sq.tabIndex = -1;
        grid.append(sq);
        if (d <= today) {
          if (n) {
            days++;
            total += n;
            streak++;
            best = Math.max(best, streak);
          } else streak = 0;
        }
      }
    }
    const wrap = el("div", "heat-wrap");
    wrap.append(grid);
    requestAnimationFrame(() => {
      wrap.scrollLeft = wrap.scrollWidth;
    });
    return { wrap, days, total, best };
  }
  function heatLegend(extra) {
    const legend = el("span", "legend");
    legend.append("Less ");
    for (let i = 0; i <= 4; i++) legend.append(el("span", `sq l${i}`));
    legend.append(" More");
    if (extra) legend.append(el("span", "newkey"), extra);
    return legend;
  }
  function activityCard() {
    const byDate = Object.fromEntries(state.library.map((d) => [d.date, d]));
    const counts = Object.fromEntries(state.library.map((d) => [d.date, d.recordings || 0]));
    const c = card("cal", "Recording activity");
    const g = heatGrid(counts, {
      title: (k, n) => `${plural(n, "recording")}, ${fmtDur(byDate[k].duration)}` + (byDate[k].status === "pending" ? " (not transcribed yet)" : ""),
      cls: (k) => byDate[k]?.status === "pending" ? "new" : "",
      onClick: (k) => go(k)
    });
    c.append(el("p", null, g.days ? `${plural(g.total, "recording")} on ${plural(g.days, "day")} in the last year \xB7 longest run ${plural(g.best, "day")} in a row` : "Days you record on will light up here."));
    c.append(g.wrap);
    const foot = el("div", "heat-foot");
    foot.append(el("span", null, "Click a day to open it"), heatLegend("not transcribed"));
    c.append(foot);
    return c;
  }
  var init_heat_grid = __esm({
    "src/home/heat-grid.ts"() {
      init_state();
      init_widgets();
      init_library();
      init_elements();
      init_format();
    }
  });

  // src/home/home.ts
  function showHome() {
    if (state.view === "day") savePosition();
    state.view = "home";
    state.date = null;
    renderTeachTray();
    state.openToken++;
    audio.pause();
    $("app").classList.add("is-home");
    $("title").textContent = "Recorder Playback";
    document.title = "Recorder Playback";
    closeDrawers();
    renderHome();
    renderLibrary();
    updateNav();
    $("home").scrollTop = 0;
  }
  function renderHome(force = false) {
    if (state.view !== "home") return;
    if (!force && $("home").contains(document.activeElement) && document.activeElement.matches("select, input")) return;
    const sig = JSON.stringify([state.library, state.jobs, state.sync, state.settings, state.checks, state.renames]);
    if (!force && sig === state.homeSig && $("home-inner").childElementCount) return;
    state.homeSig = sig;
    const inner = $("home-inner");
    const lib = state.library;
    const s = state.settings || {};
    const frag = document.createDocumentFragment();
    const pending = lib.filter((d) => d.status === "pending" && !d.job);
    const ready = lib.filter((d) => d.status === "ready");
    $("subtitle").textContent = lib.length ? `${plural(lib.length, "day")} \xB7 ${ready.length} transcribed` : "No recordings yet";
    const hello = el("div");
    hello.append(
      el("h2", "hello", s.setup_done ? "Welcome back" : "Welcome"),
      el("p", "lead", s.setup_done ? "Plug in the recorder and sync, or pick a day to listen to." : "Two quick steps: check the setup below, then sync your recorder. Nothing is transcribed until you say so.")
    );
    frag.append(hello);
    const sync = state.sync || {};
    const job = sync.job || {};
    const recs = (sync.recorders || []).filter((r) => r.new > 0);
    if (job.running || recs.length) {
      const verb = sync.mode === "move" ? "Move" : "Copy";
      const rc = card("usb", job.running ? `${verb === "Move" ? "Moving" : "Copying"} from ${job.label}` : `New recordings on ${recs[0].label}`, "attention sync-card");
      if (job.running) {
        rc.append(el("p", null, "Keep the recorder plugged in until this finishes."));
        rc.append(progressBar(
          job.bytes_total ? job.bytes_done / job.bytes_total : 0,
          `${job.current || "Starting"} (${Math.min(job.files_done + 1, job.files_total)} of ${job.files_total})`,
          job.bytes_total ? `${fmtBytes(job.bytes_done)} of ${fmtBytes(job.bytes_total)}` : ""
        ));
      } else {
        for (const r of recs) {
          if (recs.length > 1) rc.append(el("div", "sync-dev", r.label));
          rc.append(el("p", "sync-what", `${plural(r.new, "new recording")} (${fmtBytes(r.new_bytes)}) from ${r.days.map(shortDate).join(", ")}` + (r.quality ? ` \xB7 ${r.quality}` : "")));
          const a = el("div", "actions");
          a.append(btn(`${verb === "Move" ? "Move" : "Sync"} ${plural(r.new, "recording")}`, "primary big", () => startSync(r)));
          rc.append(a);
        }
        rc.append(el("p", "note", (s.auto_transcribe ? "Auto-transcribe is on: these days start transcribing as soon as they\u2019re copied." : "Auto-transcribe is off: after copying, the days wait for you to press Transcribe.") + (sync.mode === "move" ? " Recordings are deleted from the recorder once each copy is checked." : " Recordings stay on the recorder too.")));
      }
      frag.append(rc);
    }
    if (state.settings && !s.setup_done) {
      const c = card("gear", "Set up", "attention");
      c.append(el("p", null, "Check that everything is ready, choose how you want it to work, then save."));
      c.append(checksList(), cachedForm("setup", (p) => saveSettings({ ...p, setup_done: true }, "Setup saved"), "Save and finish setup"));
      frag.append(c);
    }
    frag.append(activityCard());
    const jobs = state.jobs || {};
    const failed = lib.filter((d) => d.job?.status === "failed");
    const tc = card("wave", "Transcription");
    if (jobs.blocked) {
      tc.append(el("p", null, `Paused: a recording on ${shortDate(jobs.blocked.date)} needs your levels before anything else is transcribed.`));
      const a = el("div", "actions");
      a.append(btn("Check it now", "primary", () => showBlocked(jobs.blocked)));
      tc.append(a);
    } else if (jobs.current) {
      const cur = jobs.current;
      tc.append(el("p", null, `Working on ${longDate(cur.date)}` + ((jobs.queued || []).length ? ` \xB7 ${(jobs.queued || []).length} more waiting` : "")));
      tc.append(progressBar(cur.progress, cur.label + "\u2026", cur.progress ? `${Math.round(cur.progress * 100)}%` : ""));
      const a = el("div", "actions");
      a.append(btn("Watch it", "small", () => go(cur.date)));
      tc.append(a);
    } else if ((jobs.queued || []).length) {
      tc.append(el("p", null, `${plural(jobs.queued.length, "day")} waiting to start.`));
    } else {
      tc.append(el("p", null, pending.length ? `${plural(pending.length, "day")} not transcribed yet.` : lib.length ? "Everything is transcribed." : "Nothing to transcribe yet. Sync the recorder first."));
    }
    if (failed.length) tc.append(el("div", "error-box", `${shortDate(failed[0].date)} failed: ${failed[0].job.error}`));
    const ta = el("div", "actions");
    if (pending.length === 1) ta.append(btn(`Transcribe ${shortDate(pending[0].date)}\u2026`, jobs.current ? "" : "primary", () => askTranscribe("Transcribe", pending[0].date)));
    else if (pending.length) ta.append(btn(`Transcribe all ${pending.length} days`, jobs.current ? "" : "primary", () => transcribe(pending.map((d) => d.date).reverse())));
    tc.append(ta);
    tc.append(el("p", "note", s.auto_transcribe ? "Auto-transcribe is on: new recordings start by themselves." : "Auto-transcribe is off: new days wait for you. Change it in Settings below."));
    frag.append(tc);
    if (lib.length) {
      const dc = card("cal", "Your days");
      const tiles = el("div", "tiles");
      for (const d of lib.slice(0, 8)) {
        const t = el("button", "tile");
        const t1 = el("div", "t1");
        t1.append(el("span", null, shortDate(d.date)));
        if (d.job?.status === "processing") t1.append(el("span", "chip processing", `${Math.round((d.job.progress || 0) * 100)}%`));
        else if (d.job) t1.append(el("span", "chip " + d.job.status, d.job.status === "failed" ? "Failed" : "Queued"));
        else if (d.status === "pending") t1.append(el("span", "chip pending", "New"));
        else if (d.needs_review) t1.append(el("span", "chip pending", "Name voices"));
        t.append(t1, el("div", "t2", [fmtDur(d.duration), plural(d.recordings || 0, "recording")].join(" \xB7 ")));
        if (d.speakers?.length) t.append(el("div", "t2", d.speakers.slice(0, 3).map(displayName).join(", ")));
        t.onclick = () => go(d.date);
        tiles.append(t);
      }
      dc.append(tiles);
      if (lib.length > 8) dc.append(el("p", "note", `All ${lib.length} days are in the library on the left.`));
      frag.append(dc);
    }
    if (state.settings && s.setup_done) {
      const det = el("details", "card");
      det.id = "settings-card";
      const sum = el("summary");
      sum.append(svg(HOME_ICONS.gear), el("span", null, "Settings"));
      det.append(sum, checksList(), cachedForm("settings", (p) => saveSettings(p, "Settings saved"), "Save settings"));
      det.open = !!state.settingsOpen;
      det.ontoggle = () => {
        state.settingsOpen = det.open;
      };
      frag.append(det);
    }
    inner.replaceChildren(frag);
  }
  var init_home = __esm({
    "src/home/home.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_drawers();
      init_heat_grid();
      init_settings();
      init_sync2();
      init_widgets();
      init_library();
      init_queue();
      init_audio();
      init_tray();
      init_dialog();
      init_elements();
      init_format();
    }
  });

  // src/home/settings.ts
  async function loadSettings(fresh = false) {
    try {
      const r = await api("/api/settings" + (fresh ? "?fresh=true" : ""));
      state.settings = r.settings;
      state.checks = r.checks;
      state.syncMode = r.sync_mode;
    } catch (e) {
      toast(`Couldn't load settings: ${e.message}`);
    }
    if (state.view === "home") renderHome();
  }
  async function saveSettings(patch, msg) {
    try {
      const r = await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      state.settings = r.settings;
      if (msg) toast(msg);
    } catch (e) {
      toast(`Couldn't save: ${e.message}`);
    }
    renderHome(true);
    refreshLibrary();
  }
  function settingsForm(onSave, saveLabel) {
    const s = state.settings || {};
    const form = el("div", "form");
    const auto = el("input", "switch");
    auto.type = "checkbox";
    auto.checked = !!s.auto_transcribe;
    const l1 = el("label", "row-l");
    const t1 = el("div");
    t1.append(el("div", null, "Transcribe new recordings automatically"), el("div", "hint", "Off: new days wait until you press Transcribe. On: they start as soon as they arrive."));
    l1.append(t1, auto);
    const async = el("input", "switch");
    async.type = "checkbox";
    async.checked = !!s.auto_sync;
    const la = el("label", "row-l");
    const ta = el("div");
    ta.append(el("div", null, "Sync recorder automatically on startup"), el("div", "hint", "If enabled, the app will automatically sync any plugged-in recorder when it starts."));
    la.append(ta, async);
    const asum = el("input", "switch");
    asum.type = "checkbox";
    asum.checked = !!s.auto_summarize;
    const l_asum = el("label", "row-l");
    const t_asum = el("div");
    t_asum.append(el("div", null, "Summarize recordings automatically"), el("div", "hint", "Off: summaries wait for you. On: they start as soon as the transcript is ready."));
    l_asum.append(t_asum, asum);
    const lang = el("select");
    LANGS.forEach(([v, n]) => {
      const o = el("option", null, n);
      o.value = v;
      lang.append(o);
    });
    lang.value = s.language || "";
    const l2 = el("label", "row-l");
    const t2 = el("div");
    t2.append(el("div", null, "Language"), el("div", "hint", "Choosing it avoids mistakes when a day starts with noise."));
    l2.append(t2, lang);
    const rustle = el("select");
    [["2", "Maximum (also quiets rustle-only moments)"], ["1", "Strong (recommended)"], ["0.5", "Gentle"], ["0", "Off"]].forEach(([v, n]) => {
      const o = el("option", null, n);
      o.value = v;
      rustle.append(o);
    });
    rustle.value = String(+(s.rustle_strength ?? 1));
    const l3 = el("label", "row-l");
    const t3 = el("div");
    t3.append(el("div", null, "Clothing-rustle cleanup"), el("div", "hint", "Turns down the scratchy sound of the mic rubbing on clothes. Voices are left alone."));
    l3.append(t3, rustle);
    form.append(l1, la, l_asum, l2, l3);
    const actions = el("div", "actions");
    actions.append(btn(saveLabel, "primary", () => onSave({ auto_transcribe: auto.checked, auto_sync: async.checked, auto_summarize: asum.checked, language: lang.value, rustle_strength: +rustle.value })));
    form.append(actions);
    return form;
  }
  var LANGS;
  var init_settings = __esm({
    "src/home/settings.ts"() {
      init_state();
      init_home();
      init_widgets();
      init_library();
      init_api();
      init_elements();
      init_toast();
      LANGS = [
        ["", "Detect automatically"],
        ["en", "English"],
        ["es", "Spanish"],
        ["fr", "French"],
        ["de", "German"],
        ["it", "Italian"],
        ["pt", "Portuguese"],
        ["nl", "Dutch"],
        ["ja", "Japanese"],
        ["zh", "Chinese"]
      ];
    }
  });

  // src/export.ts
  function exportTxt() {
    if (!isReady()) return;
    const lines = [`Transcript: ${longDate(state.date)}`, ""];
    let last = null, lastSrc = -1;
    for (const s of state.segments) {
      if (state.hidden.has(s.speaker)) continue;
      const src = srcIndexAt(s.start);
      if (src !== lastSrc && src >= 0 && state.sources.length > 1) {
        lines.push("", `=== Recording ${src + 1} (${clock(state.sources[src].recorded_at) || fmt(state.sources[src].start)}) ===`);
        last = null;
      }
      lastSrc = src;
      if (s.speaker !== last) {
        lines.push("", `[${clockAt(s.start) || fmt(s.start)}] ${displayName(s.speaker)}:`);
        last = s.speaker;
      }
      lines.push(s.text);
    }
    const blob = new Blob([lines.join("\n").trim() + "\n"], { type: "text/plain" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.date}_transcript.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  }
  var init_export = __esm({
    "src/export.ts"() {
      init_state();
      init_helpers();
      init_elements();
      init_format();
    }
  });

  // src/events.ts
  function init7() {
    $("export-btn").onclick = exportTxt;
    $("help-btn").onclick = () => $("help-dlg").showModal();
    $("library-toggle").onclick = () => openDrawer("library");
    $("details-toggle").onclick = () => openDrawer("details");
    $("scrim").onclick = closeDrawers;
    $("prev-day").onclick = () => stepDay(-1);
    $("next-day").onclick = () => stepDay(1);
    $("refresh-btn").onclick = () => refreshLibrary(false);
    $("lib-home").onclick = () => go("");
    $("lib-people").onclick = () => {
      go("people");
      closeDrawers();
    };
    $("lib-overview").onclick = () => {
      go("overview");
      closeDrawers();
    };
    $("lib-meetings").onclick = () => {
      go("meetings");
      closeDrawers();
    };
    $("brand").onclick = () => state.server && go("");
    $("brand").onkeydown = (e) => {
      if (e.key === "Enter") $("brand").onclick(null);
    };
    $("process-all").onclick = () => transcribe(state.library.filter((d) => d.status === "pending" && !d.job).map((d) => d.date).reverse());
    $("banner-btn").onclick = () => askTranscribe("Re-transcribe");
    $("redo-btn").onclick = () => askTranscribe("Re-transcribe");
    $("review-btn").onclick = () => {
      $("voices-dlg").returnValue = "";
      openVoiceReview();
    };
    $("process-dlg").addEventListener("input", (e) => {
      if (e.target.type === "number") e.target.closest("label").querySelector("input[type=radio]").checked = true;
    });
    $("process-dlg").addEventListener("cancel", (e) => {
      if ($("process-dlg").classList.contains("blocked")) e.preventDefault();
    });
    $("lib-list").addEventListener("click", (e) => {
      const card2 = e.target.closest(".day-card");
      if (card2) {
        go(card2.dataset.date);
        closeDrawers();
      }
    });
    window.addEventListener("hashchange", () => {
      const d = decodeURIComponent(location.hash.slice(1));
      if (!d) {
        if (state.server && state.view !== "home") showHome();
      } else if (d === "people") {
        if (state.view !== "people") showPeople();
      } else if (d === "overview") {
        if (state.view !== "overview") showOverview();
      } else if (d === "meetings") {
        if (state.view !== "meetings") showMeetings();
      } else if (d !== state.date && libItem(d)) openDay(d);
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshLibrary();
    });
    $("noise-toggle").onclick = () => {
      state.showNoise = !state.showNoise;
      renderTranscript();
    };
    $("noise-trash").onclick = () => editLines("trash", state.segments.filter((s) => s.noise));
    $("play").onclick = togglePlay;
    $("back").onclick = () => seek(audio.currentTime - 10);
    $("fwd").onclick = () => seek(audio.currentTime + 10);
    $("rate").onclick = () => setRate(RATES[(RATES.indexOf(audio.playbackRate) + 1) % RATES.length] || 1);
    $("vol").oninput = (e) => {
      audio.volume = +e.target.value;
      store.set("vol", audio.volume);
    };
    $("jump").onclick = () => {
      state.userScrolledAt = 0;
      document.querySelector(".cue.active")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    $("follow").onchange = () => {
      state.userScrolledAt = 0;
      syncActive(true);
    };
    $("transcript").addEventListener("click", (e) => {
      const cue = e.target.closest(".cue");
      if (cue) seek(state.segments[+cue.dataset.i].start, true);
    });
    ["wheel", "touchmove"].forEach((t) => $("transcript").addEventListener(t, () => state.userScrolledAt = Date.now(), { passive: true }));
    $("transcript").addEventListener("scroll", () => updateJump(), { passive: true });
    audio.addEventListener("timeupdate", () => {
      updateProgress();
      syncActive();
      updateActiveSource();
      updateNow();
    });
    audio.addEventListener("play", () => {
      updatePlayIcon();
      syncActive(true);
    });
    audio.addEventListener("pause", () => {
      updatePlayIcon();
      savePosition();
      syncActive(true);
    });
    audio.addEventListener("ended", () => {
      updatePlayIcon();
      if (!isReady() && state.rawIdx >= 0 && state.rawIdx < state.sources.length - 1) playRaw(state.rawIdx + 1);
    });
    audio.addEventListener("loadedmetadata", updateProgress);
    audio.addEventListener("error", () => {
      if (audio.getAttribute("src")) toast("Couldn't play that audio file.");
    });
    window.addEventListener("beforeunload", savePosition);
    setInterval(() => {
      if (!audio.paused) savePosition();
    }, 5e3);
  }
  var init_events = __esm({
    "src/events.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_open();
      init_recordings();
      init_drawers();
      init_export();
      init_home();
      init_library();
      init_queue();
      init_page();
      init_data2();
      init_page2();
      init_audio();
      init_sync();
      init_dialog2();
      init_dialog();
      init_edit();
      init_render2();
      init_store();
      init_toast();
    }
  });

  // src/search.ts
  function gotoMatch(dir) {
    if (!state.matches.length) return;
    state.matches[state.matchIdx]?.classList.remove("current");
    state.matchIdx = (state.matchIdx + dir + state.matches.length) % state.matches.length;
    const m = state.matches[state.matchIdx];
    m.classList.add("current");
    m.scrollIntoView({ behavior: "smooth", block: "center" });
    state.userScrolledAt = Date.now();
    $("search-count").textContent = `${state.matchIdx + 1} of ${state.matches.length}`;
  }
  function init8() {
    $("search").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderTranscript, 150);
    });
    $("search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        gotoMatch(e.shiftKey ? -1 : 1);
      }
      if (e.key === "Escape") {
        e.target.value = "";
        renderTranscript();
        e.target.blur();
      }
    });
  }
  var searchTimer;
  var init_search = __esm({
    "src/search.ts"() {
      init_dom();
      init_state();
      init_render2();
    }
  });

  // src/keyboard.ts
  function init9() {
    document.addEventListener("keydown", (e) => {
      if ($("app").classList.contains("hidden") || document.querySelector("dialog[open]")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "checkbox" && e.target.type !== "range";
      if (typing) return;
      const k = e.key;
      if (k === "Escape") closeDrawers();
      else if (k === " " || k === "k" || k === "K") {
        if (k === " " && e.target.tagName === "BUTTON") return;
        e.preventDefault();
        togglePlay();
      } else if (k === "ArrowLeft" && e.shiftKey) {
        e.preventDefault();
        stepDay(-1);
      } else if (k === "ArrowRight" && e.shiftKey) {
        e.preventDefault();
        stepDay(1);
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        seek(audio.currentTime - 10);
      } else if (k === "ArrowRight") {
        e.preventDefault();
        seek(audio.currentTime + 10);
      } else if (k === "j" || k === "J") stepLine(-1);
      else if (k === "l" || k === "L") stepLine(1);
      else if (k === "[") setRate(RATES[Math.max(0, RATES.indexOf(audio.playbackRate) - 1)] ?? 1);
      else if (k === "]") setRate(RATES[Math.min(RATES.length - 1, RATES.indexOf(audio.playbackRate) + 1)] ?? 1);
      else if (k === "/" && isReady()) {
        e.preventDefault();
        $("search").focus();
      } else if (k === "f" || k === "F") {
        $("follow").checked = !$("follow").checked;
        $("follow").onchange(null);
        toast($("follow").checked ? "Following audio" : "Follow off");
      } else if (k === "?") $("help-dlg").showModal();
      else if (k === "Delete" || k === "Backspace") {
        const cue = document.activeElement?.closest?.(".cue");
        if (cue && isReady()) {
          e.preventDefault();
          const next = cue.closest(".cue-row")?.nextElementSibling?.querySelector(".cue") || cue.closest(".turn")?.nextElementSibling?.querySelector(".cue");
          const nextIdx = next ? +next.dataset.i : null;
          editLines("trash", [state.segments[+cue.dataset.i]]).then(() => {
            if (nextIdx !== null) document.querySelector(`.cue[data-i="${nextIdx - 1}"]`)?.focus();
          });
        }
      }
    });
  }
  var init_keyboard = __esm({
    "src/keyboard.ts"() {
      init_dom();
      init_state();
      init_helpers();
      init_drawers();
      init_library();
      init_audio();
      init_edit();
      init_toast();
    }
  });

  // src/main.ts
  var require_main = __commonJS({
    "src/main.ts"() {
      init_dom();
      init_state();
      init_settings();
      init_sync2();
      init_library();
      init_audio();
      init_api();
      init_store();
      init_snippets();
      init_dialog2();
      init_dialog3();
      init_actions();
      init_events();
      init_preview();
      init_timeline();
      init_search();
      init_keyboard();
      init3();
      init5();
      init6();
      init4();
      init7();
      init2();
      init();
      init8();
      init9();
      setRate(store.get("rate", 1));
      audio.volume = store.get("vol", 1);
      $("vol").value = String(audio.volume);
      api("/api/library").then(() => {
        state.server = true;
        loadSettings();
        refreshSync();
        refreshLibrary();
      }).catch((e) => {
        $("empty-title").textContent = "Can\u2019t reach the server";
        $("empty-text").textContent = `${e.message || "No answer"}. Is app.py running?`;
        $("empty-retry").classList.remove("hidden");
        $("empty-retry").onclick = () => location.reload();
      });
    }
  });
  require_main();
})();
