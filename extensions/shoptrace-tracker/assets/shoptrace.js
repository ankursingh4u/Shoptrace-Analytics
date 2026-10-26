/* Shoptrace Analytics storefront tracker.
 *
 * Captures pageviews, clicks, scroll depth, cart/checkout milestones,
 * optional rrweb session recordings, and renders survey widgets.
 * All data flows through the shop's own domain via the Shopify app proxy
 * (default /apps/shoptrace), so there are no third-party requests and the
 * shop identity is signed by Shopify server-side.
 */
(function () {
  "use strict";

  var script =
    document.currentScript || document.querySelector("script[data-shoptrace]");
  var PROXY = (script && script.getAttribute("data-proxy")) || "/apps/shoptrace";
  var RECORD_SRC = script && script.getAttribute("data-record-src");

  // Never track the theme editor preview, automated browsers, or iframes
  // (e.g. the heatmap preview inside the app itself).
  if (window.Shopify && window.Shopify.designMode) return;
  if (navigator.webdriver) return;
  if (window.top !== window.self) return;
  if (window.__shoptraceLoaded) return;
  window.__shoptraceLoaded = true;

  /* ---------- ids ---------- */

  function rid() {
    var chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    var out = "";
    var rnd = new Uint8Array(21);
    (window.crypto || window.msCrypto).getRandomValues(rnd);
    for (var i = 0; i < 21; i++) out += chars[rnd[i] % chars.length];
    return out;
  }

  function store(storage, key, make) {
    try {
      var v = storage.getItem(key);
      if (!v) {
        v = make();
        storage.setItem(key, v);
      }
      return v;
    } catch (e) {
      return make();
    }
  }

  var vid = store(localStorage, "st_vid", rid);

  // 30-minute inactivity window defines a session.
  var SESSION_MS = 30 * 60 * 1000;
  var sid;
  try {
    var seen = Number(sessionStorage.getItem("st_seen") || 0);
    sid = sessionStorage.getItem("st_sid");
    if (!sid || Date.now() - seen > SESSION_MS) {
      sid = rid();
      sessionStorage.setItem("st_sid", sid);
    }
    sessionStorage.setItem("st_seen", String(Date.now()));
  } catch (e) {
    sid = rid();
  }

  function touchSession() {
    try {
      sessionStorage.setItem("st_seen", String(Date.now()));
    } catch (e) {
      /* noop */
    }
  }

  /* ---------- transport ---------- */

  var queue = [];
  var metaSent = false;

  function buildMeta() {
    var tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (e) {
      /* noop */
    }
    return {
      lang: navigator.language || "",
      tz: tz,
      sw: window.screen ? screen.width : 0,
      sh: window.screen ? screen.height : 0,
      ref: document.referrer || "",
      landing: location.pathname,
    };
  }

  function flush(useBeacon) {
    if (!queue.length) return;
    var payload = { sid: sid, vid: vid, events: queue.splice(0, 100) };
    if (!metaSent) {
      payload.meta = buildMeta();
      metaSent = true;
    }
    var body = JSON.stringify(payload);
    var url = PROXY + "/collect";
    touchSession();
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      keepalive: true,
    }).catch(function () {
      /* drop silently — analytics must never break the storefront */
    });
  }

  function push(ev) {
    queue.push(ev);
    if (queue.length >= 12) flush(false);
  }

  setInterval(function () {
    flush(false);
  }, 10000);

  /* ---------- pageviews ---------- */

  var pv = null;
  var excluded = false;
  var excludePaths = [];

  function isExcluded(path) {
    for (var i = 0; i < excludePaths.length; i++) {
      if (path.indexOf(excludePaths[i]) === 0) return true;
    }
    return false;
  }

  function endPageview() {
    if (!pv) return;
    push({
      t: "pv_end",
      id: pv.id,
      sec: Math.round((Date.now() - pv.start) / 1000),
      scroll: pv.maxScroll,
    });
    pv = null;
  }

  function startPageview() {
    excluded = isExcluded(location.pathname);
    if (excluded) return;
    pv = {
      id: rid(),
      start: Date.now(),
      maxScroll: 0,
    };
    push({
      t: "pv",
      id: pv.id,
      path: location.pathname,
      title: document.title || "",
    });
    if (location.pathname.indexOf("/products/") !== -1) {
      push({ t: "product_view" });
    }
    updateScroll();
  }

  function updateScroll() {
    if (!pv) return;
    var doc = document.documentElement;
    var height = Math.max(doc.scrollHeight, 1);
    var reached = Math.min(
      100,
      Math.round(((window.scrollY + window.innerHeight) / height) * 100),
    );
    if (reached > pv.maxScroll) pv.maxScroll = reached;
  }

  window.addEventListener("scroll", updateScroll, { passive: true });

  // SPA-ish themes: re-track on history navigation.
  function onNavigate() {
    endPageview();
    startPageview();
  }
  var origPush = history.pushState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    onNavigate();
  };
  var origReplace = history.replaceState;
  history.replaceState = function () {
    origReplace.apply(this, arguments);
    // replaceState doesn't change the page — only re-check exclusion.
  };
  window.addEventListener("popstate", onNavigate);

  window.addEventListener("pagehide", function () {
    endPageview();
    flush(true);
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      updateScroll();
      flush(true);
    }
  });

  /* ---------- clicks & milestones ---------- */

  function cssPath(el) {
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 3) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(part + "#" + node.id);
        break;
      }
      if (node.classList && node.classList.length) {
        part += "." + node.classList[0];
      }
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }
    return parts.join(" > ").slice(0, 200);
  }

  document.addEventListener(
    "click",
    function (e) {
      if (excluded) return;
      touchSession();
      var doc = document.documentElement;
      var dw = Math.max(doc.scrollWidth, 1);
      var dh = Math.max(doc.scrollHeight, 1);
      var target = e.target && e.target.nodeType === 1 ? e.target : null;
      push({
        t: "click",
        path: location.pathname,
        x: Math.min(1, Math.max(0, e.pageX / dw)),
        y: Math.min(1, Math.max(0, e.pageY / dh)),
        dw: dw,
        dh: dh,
        sel: target ? cssPath(target) : "",
      });
      if (target) {
        var hit =
          target.closest &&
          target.closest(
            '[name="checkout"], a[href*="/checkout"], form[action*="/checkout"] [type="submit"]',
          );
        if (hit) {
          push({ t: "checkout" });
          flush(false);
        }
      }
    },
    true,
  );

  // Add-to-cart detection: wrap fetch and XHR for /cart/add.
  function isCartAdd(url) {
    return typeof url === "string" && url.indexOf("/cart/add") !== -1;
  }
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      try {
        var u = typeof input === "string" ? input : input && input.url;
        if (isCartAdd(u)) push({ t: "cart_add" });
      } catch (e) {
        /* noop */
      }
      return origFetch.apply(this, arguments);
    };
  }
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (isCartAdd(url)) push({ t: "cart_add" });
    } catch (e) {
      /* noop */
    }
    return origOpen.apply(this, arguments);
  };
  // Classic non-AJAX cart forms.
  document.addEventListener(
    "submit",
    function (e) {
      var form = e.target;
      if (form && form.action && isCartAdd(form.action)) {
        push({ t: "cart_add" });
        flush(true);
      }
    },
    true,
  );

  /* ---------- session recording (rrweb) ---------- */

  function sampleHit(rate) {
    if (rate >= 100) return true;
    var h = 0;
    for (var i = 0; i < sid.length; i++) h = (h * 31 + sid.charCodeAt(i)) >>> 0;
    return h % 100 < rate;
  }

  function startRecording(cfg) {
    if (!RECORD_SRC || !sampleHit(cfg.sample || 100)) return;
    var s = document.createElement("script");
    s.src = RECORD_SRC;
    s.async = true;
    s.onload = function () {
      var rr = window.rrweb || window.rrwebRecord;
      var record = rr && (rr.record || rr);
      if (typeof record !== "function") return;
      var buffer = [];
      var seq = 0;
      var startedAt = Date.now();
      var stop = null;

      function ship(useBeacon) {
        if (!buffer.length) return;
        var body = JSON.stringify({
          sid: sid,
          seq: seq++,
          events: buffer.splice(0, buffer.length),
        });
        if (body.length > 1900000) return; // oversized chunk — drop, keep going
        var url = PROXY + "/record";
        if (useBeacon && navigator.sendBeacon && body.length < 60000) {
          navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
          return;
        }
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: body.length < 60000,
        }).catch(function () {});
      }

      try {
        stop = record({
          emit: function (event) {
            buffer.push(event);
          },
          maskAllInputs: true,
          blockClass: "st-noreplay",
          sampling: { mousemove: 80, scroll: 150, input: "last" },
        });
      } catch (e) {
        return;
      }

      var timer = setInterval(function () {
        if (Date.now() - startedAt > (cfg.maxSeconds || 300) * 1000) {
          ship(false);
          clearInterval(timer);
          if (stop) stop();
          return;
        }
        ship(false);
      }, 5000);

      window.addEventListener("pagehide", function () {
        ship(true);
      });
    };
    document.head.appendChild(s);
  }

  /* ---------- surveys ---------- */

  var SURVEY_CSS =
    ".st-sv{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:320px;max-width:calc(100vw - 36px);" +
    "background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(11,22,38,.28);overflow:hidden;" +
    "font-family:Inter,system-ui,-apple-system,sans-serif;animation:stSvIn .3s ease}" +
    "@keyframes stSvIn{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}" +
    ".st-sv-head{background:linear-gradient(118deg,#0b1626 0%,#0d3b4f 55%,#0c8a70 130%);color:#fff;padding:14px 16px;" +
    "display:flex;justify-content:space-between;align-items:flex-start;gap:10px}" +
    ".st-sv-q{font-size:13.5px;font-weight:600;line-height:1.45;margin:0}" +
    ".st-sv-x{background:none;border:none;color:rgba(255,255,255,.7);font-size:16px;cursor:pointer;line-height:1;padding:0}" +
    ".st-sv-body{padding:14px 16px}" +
    ".st-sv textarea{width:100%;box-sizing:border-box;border:1px solid #e3e3de;border-radius:10px;padding:9px 11px;" +
    "font-size:13px;font-family:inherit;resize:vertical;min-height:64px}" +
    ".st-sv-btn{display:block;width:100%;margin-top:10px;background:#0c8a70;color:#fff;border:none;border-radius:10px;" +
    "padding:10px;font-size:13px;font-weight:700;cursor:pointer}" +
    ".st-sv-btn:hover{background:#0a7560}" +
    ".st-sv-stars{display:flex;gap:6px;justify-content:center;font-size:26px}" +
    ".st-sv-star{cursor:pointer;color:#d7d7d2;background:none;border:none;padding:2px;font-size:26px;line-height:1}" +
    ".st-sv-star.on{color:#d97706}" +
    ".st-sv-choice{display:block;width:100%;margin-bottom:8px;background:#f3f6f4;border:1px solid #e3e3de;" +
    "border-radius:10px;padding:10px;font-size:13px;cursor:pointer;text-align:left;font-family:inherit}" +
    ".st-sv-choice:hover{background:#e3f5f0;border-color:#0c8a70}" +
    ".st-sv-thanks{padding:22px 16px;text-align:center;font-size:13.5px;color:#0b1626}" +
    ".st-sv-brand{font-size:10px;color:#9a9a94;text-align:right;padding:0 16px 10px}";

  function surveyDone(id) {
    try {
      return !!localStorage.getItem("st_sv_" + id);
    } catch (e) {
      return false;
    }
  }
  function markSurvey(id) {
    try {
      localStorage.setItem("st_sv_" + id, "1");
    } catch (e) {
      /* noop */
    }
  }

  function submitSurvey(id, answer) {
    fetch(PROXY + "/survey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surveyId: id, sid: sid, answer: String(answer).slice(0, 2000) }),
      keepalive: true,
    }).catch(function () {});
  }

  function showSurvey(sv) {
    if (surveyDone(sv.id)) return;
    if (sv.pages && location.pathname.indexOf(sv.pages) !== 0) return;

    setTimeout(function () {
      if (document.getElementById("st-sv-root")) return;
      var style = document.createElement("style");
      style.textContent = SURVEY_CSS;
      document.head.appendChild(style);

      var root = document.createElement("div");
      root.id = "st-sv-root";
      root.className = "st-sv st-noreplay";

      var bodyHtml = "";
      if (sv.type === "rating") {
        bodyHtml =
          '<div class="st-sv-stars">' +
          [1, 2, 3, 4, 5]
            .map(function (n) {
              return '<button class="st-sv-star" data-v="' + n + '" aria-label="' + n + ' stars">★</button>';
            })
            .join("") +
          "</div>";
      } else if (sv.type === "choice") {
        bodyHtml = (sv.options || [])
          .map(function (o) {
            return '<button class="st-sv-choice">' + String(o).replace(/[<>&]/g, "") + "</button>";
          })
          .join("");
      } else {
        bodyHtml =
          '<textarea maxlength="2000" placeholder="Type your answer…"></textarea>' +
          '<button class="st-sv-btn">Send</button>';
      }

      root.innerHTML =
        '<div class="st-sv-head"><p class="st-sv-q"></p>' +
        '<button class="st-sv-x" aria-label="Dismiss">✕</button></div>' +
        '<div class="st-sv-body">' +
        bodyHtml +
        "</div>" +
        '<div class="st-sv-brand">Powered by Shoptrace</div>';
      root.querySelector(".st-sv-q").textContent = sv.question;
      document.body.appendChild(root);

      function finish() {
        markSurvey(sv.id);
        var body = root.querySelector(".st-sv-body");
        body.innerHTML = '<div class="st-sv-thanks">✓ Thanks for your feedback!</div>';
        setTimeout(function () {
          root.remove();
        }, 1800);
      }

      root.querySelector(".st-sv-x").addEventListener("click", function () {
        markSurvey(sv.id);
        root.remove();
      });

      if (sv.type === "rating") {
        var stars = root.querySelectorAll(".st-sv-star");
        stars.forEach(function (star) {
          star.addEventListener("mouseenter", function () {
            var v = Number(star.getAttribute("data-v"));
            stars.forEach(function (s2, i) {
              s2.classList.toggle("on", i < v);
            });
          });
          star.addEventListener("click", function () {
            submitSurvey(sv.id, star.getAttribute("data-v"));
            finish();
          });
        });
      } else if (sv.type === "choice") {
        root.querySelectorAll(".st-sv-choice").forEach(function (btn) {
          btn.addEventListener("click", function () {
            submitSurvey(sv.id, btn.textContent);
            finish();
          });
        });
      } else {
        root.querySelector(".st-sv-btn").addEventListener("click", function () {
          var text = root.querySelector("textarea").value.trim();
          if (!text) return;
          submitSurvey(sv.id, text);
          finish();
        });
      }
    }, (sv.delay || 5) * 1000);
  }

  /* ---------- boot ---------- */

  fetch(PROXY + "/boot", { headers: { Accept: "application/json" } })
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (boot) {
      if (!boot || !boot.enabled) return;
      excludePaths = boot.excludePaths || [];
      startPageview();
      if (boot.recording && boot.recording.enabled && !excluded) {
        startRecording(boot.recording);
      }
      (boot.surveys || []).slice(0, 1).forEach(showSurvey);
    })
    .catch(function () {
      /* tracking stays off if boot fails */
    });
})();
