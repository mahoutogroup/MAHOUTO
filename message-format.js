/* =========================================================
   Mise en forme des messages du chat (salons + discussions privées)

   MahoutoMessageFormat.render(conteneur, texte, { scroller })

   - Le texte n'est JAMAIS interprété comme du HTML : tout est construit avec
     createElement / createTextNode (aucun innerHTML), donc rien à échapper.
   - Retours à la ligne conservés (white-space: pre-wrap), lignes vides = espace entre paragraphes.
   - **gras**, `code`, titres (# / ## ...), listes (- , * , 1. ) avec retrait,
     blocs ``` avec bouton « Copier », liens http(s) / www cliquables.
   - Message long (> 500 caractères ou > 12 lignes) : replié (~8 lignes) avec « Voir plus / Voir moins ».
   Aucune dépendance. CSS : message-format.css.
   ========================================================= */
(function (root) {
  "use strict";

  var LONG_CHARS = 500;
  var LONG_LINES = 12;
  var COLLAPSED_LINES = 8;
  var uid = 0;

  // Ordre d'importance : `code`, **gras**, lien
  var INLINE_SRC = "(`[^`\\n]+`)|(\\*\\*[^*\\s](?:[^*\\n]*[^*\\s])?\\*\\*)|(\\bhttps?:\\/\\/[^\\s<]+|\\bwww\\.[^\\s<]+)";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function count(str, ch) { return str.split(ch).length - 1; }

  // Retire la ponctuation finale qui n'appartient pas à l'adresse
  function splitUrlTail(raw) {
    var tail = "";
    for (;;) {
      var last = raw.charAt(raw.length - 1);
      if (/[.,;:!?'"»]/.test(last) ||
          (last === ")" && count(raw, ")") > count(raw, "(")) ||
          (last === "]" && count(raw, "]") > count(raw, "["))) {
        tail = last + tail;
        raw = raw.slice(0, -1);
      } else break;
    }
    return { url: raw, tail: tail };
  }

  function appendInline(parent, text, inBold) {
    var re = new RegExp(INLINE_SRC, "gi");
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) {
        parent.appendChild(el("code", "mf-ic", m[1].slice(1, -1)));
      } else if (m[2]) {
        var strong = el("strong");
        if (inBold) strong.textContent = m[2].slice(2, -2);
        else appendInline(strong, m[2].slice(2, -2), true);
        parent.appendChild(strong);
      } else {
        var parts = splitUrlTail(m[3]);
        if (parts.url.length > 4) {
          var a = el("a", "mf-link", parts.url);
          a.href = /^https?:\/\//i.test(parts.url) ? parts.url : "https://" + parts.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          parent.appendChild(a);
          if (parts.tail) parent.appendChild(document.createTextNode(parts.tail));
        } else {
          parent.appendChild(document.createTextNode(m[3]));
        }
      }
      last = re.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  // Texte hors bloc de code : paragraphes, titres, listes
  function renderText(parent, text) {
    var lines = text.split("\n");
    var para = [];
    var gap = false;

    function place(node, kind) {
      var prev = parent.lastElementChild;
      if (prev) {
        var prevKind = prev.getAttribute("data-k");
        var mt = "0.2em";
        if (gap) mt = "0.65em";
        else if (kind === "h") mt = "0.5em";
        else if (kind === "li" && prevKind === "li") mt = "0.12em";
        node.style.marginTop = mt;
      }
      node.setAttribute("data-k", kind);
      parent.appendChild(node);
      gap = false;
    }
    function flush() {
      if (!para.length) return;
      var p = el("div", "mf-p");
      appendInline(p, para.join("\n"), false);
      place(p, "p");
      para = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var h, li;
      if (/^\s*$/.test(line)) {
        flush();
        gap = true;
      } else if ((h = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/.exec(line))) {
        flush();
        var hd = el("div", "mf-h" + (h[1].length === 1 ? " mf-h1" : ""));
        appendInline(hd, h[2].replace(/\s+#+$/, ""), true);
        hd.setAttribute("role", "heading");
        hd.setAttribute("aria-level", String(Math.min(h[1].length + 2, 6)));
        place(hd, "h");
      } else if ((li = /^(\s*)([-*•]|\d{1,3}[.)])\s+(.*)$/.exec(line))) {
        flush();
        var item = el("div", "mf-li");
        var level = Math.min(Math.floor(li[1].replace(/\t/g, "  ").length / 2), 3);
        if (level) item.style.marginLeft = (level * 1.2) + "em";
        appendInline(item, li[2] + " " + li[3], false);
        place(item, "li");
      } else {
        para.push(line);
      }
    }
    flush();
  }

  function copyText(text) {
    if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error("copy"));
    });
  }

  function renderCode(parent, raw) {
    var code = raw.replace(/^\n/, "").replace(/\n$/, "");
    var lang = "";
    if (!/^\n/.test(raw)) {
      var lm = /^([A-Za-z0-9_+#.-]{1,20})\n/.exec(raw);
      if (lm) { lang = lm[1]; code = raw.slice(lm[0].length).replace(/\n$/, ""); }
    }
    var box = el("div", "mf-code");
    box.setAttribute("data-k", "code");
    var bar = el("div", "mf-code-bar");
    bar.appendChild(el("span", "mf-lang", lang || "code"));
    var btn = el("button", "mf-copy", "Copier");
    btn.type = "button";
    var status = el("span", "mf-sr");
    status.setAttribute("role", "status");
    var timer = null;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();   // ne pas ouvrir le menu d'actions du message
      e.preventDefault();
      function done(label, msg) {
        btn.textContent = label;
        status.textContent = msg;
        clearTimeout(timer);
        timer = setTimeout(function () { btn.textContent = "Copier"; status.textContent = ""; }, 1600);
      }
      copyText(code).then(function () { done("Copié", "Code copié"); },
                          function () { done("Échec", "Copie impossible"); });
    });
    bar.appendChild(btn);
    box.appendChild(bar);
    var pre = el("pre");
    pre.appendChild(el("code", null, code));
    box.appendChild(pre);
    box.appendChild(status);

    var prev = parent.lastElementChild;
    if (prev) box.style.marginTop = "0.6em";
    parent.appendChild(box);
    // l'élément suivant (texte) prend sa marge par place() ; on garde un espace sous le bloc
    box.style.marginBottom = "0.15em";
  }

  function isLong(text) {
    return text.length > LONG_CHARS || text.split("\n").length > LONG_LINES;
  }

  function setupFold(container, content, scroller) {
    var id = "mf-c" + (++uid);
    content.id = id;
    content.classList.add("mf-collapsed");

    var btn = el("button", "mf-toggle", "Voir plus");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", id);
    container.appendChild(btn);

    var collapsed = true;
    var cut = null;
    var lastW = -1;

    function nearBottom() {
      return scroller && (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140);
    }

    // Mesure (seulement quand la bulle est affichée) : coupe à la fin d'un bloc plutôt qu'au milieu
    function measure() {
      if (!collapsed) return;
      var w = content.offsetWidth;
      if (!w || w === lastW) return;
      lastW = w;
      var stick = nearBottom();
      var cs = root.getComputedStyle(content);
      var lh = parseFloat(cs.lineHeight);
      if (!lh) lh = (parseFloat(cs.fontSize) || 16) * 1.5;
      var limit = lh * COLLAPSED_LINES;

      content.style.maxHeight = "none";
      var full = content.scrollHeight;
      var kids = content.children;
      var best = 0, overTop = null, overKind = null;
      for (var i = 0; i < kids.length; i++) {
        var bottom = kids[i].offsetTop + kids[i].offsetHeight;
        if (bottom <= limit + 1) best = bottom;
        else { overTop = kids[i].offsetTop; overKind = kids[i].getAttribute("data-k"); break; }
      }
      var c = limit;
      if (best >= limit * 0.5) c = best;
      else if (overKind === "code") c = best >= lh * 2 ? best : limit;   // jamais au milieu d'un bloc de code si on peut l'éviter
      else if (overTop != null) c = overTop + Math.max(2, Math.floor((limit - overTop) / lh)) * lh;

      // Un lien (même replié sur plusieurs lignes) n'est jamais coupé par le repli : on remonte au début du lien
      var top0 = content.getBoundingClientRect().top;
      var links = content.querySelectorAll("a.mf-link");
      for (var k = 0; k < links.length; k++) {
        var rects = links[k].getClientRects();
        if (rects.length < 2) continue;
        var rTop = rects[0].top - top0, rBottom = rects[rects.length - 1].bottom - top0;
        if (rTop < c - 1 && rBottom > c + 1 && rTop >= lh * 2) c = rTop - 2;
      }

      if (full <= c + 2) {                 // rien de caché : pas de repli
        content.classList.remove("mf-collapsed");
        content.style.maxHeight = "";
        btn.hidden = true;
        collapsed = false;
        cut = null;
      } else {
        cut = c;
        content.style.maxHeight = c + "px";
        btn.hidden = false;
      }
      if (stick) scroller.scrollTop = scroller.scrollHeight;
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();   // ne pas ouvrir le menu d'actions du message
      e.preventDefault();
      // Garde le point de repère à la même place : le haut du texte quand on déplie, le bouton quand on replie
      var anchor = collapsed ? content : btn;
      var before = anchor.getBoundingClientRect().top;
      collapsed = !collapsed;
      content.classList.toggle("mf-collapsed", collapsed);
      if (collapsed) { lastW = -1; measure(); if (collapsed && cut == null) content.style.maxHeight = ""; }
      else content.style.maxHeight = "";
      btn.textContent = collapsed ? "Voir plus" : "Voir moins";
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      if (scroller) {
        var after = anchor.getBoundingClientRect().top;
        if (after !== before) scroller.scrollTop += after - before;
      }
    });

    if (root.ResizeObserver) new root.ResizeObserver(measure).observe(container);
    else root.setTimeout(measure, 0);
  }

  function render(container, text, opts) {
    opts = opts || {};
    text = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
    container.textContent = "";
    container.classList.add("mf-body");

    var content = el("div", "mf-content");
    var parts = text.split(/```([\s\S]*?)```/g);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) renderCode(content, parts[i]);
      else if (parts[i]) renderText(content, parts[i]);
    }
    container.appendChild(content);

    if (isLong(text)) setupFold(container, content, opts.scroller || null);
  }

  root.MahoutoMessageFormat = { render: render, isLong: isLong };
})(window);
