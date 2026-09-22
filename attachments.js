/* =========================================================
   MAHOUTO+ — Pièces jointes professionnelles
   Module partagé par chat.html et dm-chat.html.

   Rôle :
   - déterminer la catégorie d'un fichier (icône + libellé) à
     partir de son extension ;
   - construire la carte de pièce jointe avec les DOM APIs
     (createElement/textContent) — jamais avec innerHTML sur des
     données venant de l'utilisateur (nom de fichier, etc.) ;
   - regrouper les appels à /api/attachment (POST) pour les pièces
     jointes "authenticated" (DM et salons payants), afin de ne
     faire qu'UNE requête par lot de messages chargés plutôt
     qu'un appel par pièce jointe.

   Ne touche jamais au texte des messages, aux accusés de
   réception, ni à la logique temps réel : uniquement le rendu
   des pièces jointes.
   ========================================================= */

window.MahoutoAttachments = (function () {

  // -------- Catégories par extension --------
  // (reflète exactement la liste validée : formats sélectionnables
  // côté <input type="file">, voir aussi ALLOWED côté serveur)
  const CATEGORY_BY_EXT = {
    // Documents Office
    doc: { icon: "📄", label: "Document Word" },
    docx: { icon: "📄", label: "Document Word" },
    xls: { icon: "📊", label: "Feuille Excel" },
    xlsx: { icon: "📊", label: "Feuille Excel" },
    csv: { icon: "📊", label: "Feuille de calcul" },
    ppt: { icon: "📊", label: "Présentation PowerPoint" },
    pptx: { icon: "📊", label: "Présentation PowerPoint" },
    txt: { icon: "📄", label: "Fichier texte" },
    md: { icon: "📄", label: "Fichier texte" },

    // Graphisme / impression (non SVG — SVG s'affiche directement)
    ai: { icon: "🎨", label: "Fichier graphique" },
    eps: { icon: "🎨", label: "Fichier graphique" },
    cdr: { icon: "🎨", label: "Fichier graphique" },
    psd: { icon: "🎨", label: "Fichier Photoshop" },

    // Photo RAW
    dng: { icon: "📷", label: "Photo RAW" },
    cr2: { icon: "📷", label: "Photo RAW" },
    cr3: { icon: "📷", label: "Photo RAW" },
    nef: { icon: "📷", label: "Photo RAW" },
    arw: { icon: "📷", label: "Photo RAW" },
    raf: { icon: "📷", label: "Photo RAW" },

    // Archives
    zip: { icon: "📦", label: "Archive" },
    rar: { icon: "📦", label: "Archive" },
    "7z": { icon: "📦", label: "Archive" },
    tar: { icon: "📦", label: "Archive" },
    gz: { icon: "📦", label: "Archive" },

    // Développement
    html: { icon: "💻", label: "Fichier de code" },
    css: { icon: "💻", label: "Fichier de code" },
    js: { icon: "💻", label: "Fichier de code" },
    ts: { icon: "💻", label: "Fichier de code" },
    json: { icon: "💻", label: "Fichier de code" },
    xml: { icon: "💻", label: "Fichier de code" },
    sql: { icon: "💻", label: "Fichier de code" },
    php: { icon: "💻", label: "Fichier de code" },
    py: { icon: "💻", label: "Fichier de code" },
    java: { icon: "💻", label: "Fichier de code" },
    c: { icon: "💻", label: "Fichier de code" },
    cpp: { icon: "💻", label: "Fichier de code" },
    h: { icon: "💻", label: "Fichier de code" },
    go: { icon: "💻", label: "Fichier de code" },
    rs: { icon: "💻", label: "Fichier de code" }
  };

  function getExtension(name) {
    if (!name) return "";
    const m = /\.([a-zA-Z0-9]+)$/.exec(name.trim());
    return m ? m[1].toLowerCase() : "";
  }

  function isPdfAttachment(msg) {
    const ext = getExtension(msg.attachment_name || "");
    if (ext === "pdf") return true;
    return /\.pdf(\?|$)/i.test(msg.attachment_url || "");
  }

  function isSvgAttachment(msg) {
    return getExtension(msg.attachment_name || "") === "svg";
  }

  // Taille lisible : 1024 o -> 1 Ko, 1024 Ko -> 1 Mo, etc. (fr-FR)
  function formatFileSize(bytes) {
    const n = Number(bytes);
    if (!n || n <= 0) return "";
    const units = ["o", "Ko", "Mo", "Go"];
    let value = n;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    const formatted = i === 0 ? String(Math.round(value)) : value.toFixed(1).replace(".", ",");
    return formatted + " " + units[i];
  }

  // Nettoie un nom de fichier pour l'utiliser dans une transformation
  // Cloudinary (fl_attachment) : les points/parenthèses/virgules cassent
  // l'URL même encodés. On retire aussi l'extension (Cloudinary la
  // rajoute lui-même au téléchargement).
  function sanitizeForCloudinaryAttachment(filename) {
    const withoutExt = String(filename || "").replace(/\.[^./\\]+$/, "");
    const safe = withoutExt.replace(/[^a-zA-Z0-9 _-]/g, "_").trim();
    return safe || "fichier";
  }

  function buildDownloadUrl(url, filename) {
    if (!url || !url.includes("/upload/") || !filename) return url;
    const safeName = sanitizeForCloudinaryAttachment(filename);
    return url.replace("/upload/", "/upload/fl_attachment:" + encodeURIComponent(safeName) + "/");
  }

  function pdfThumbnailUrl(url) {
    if (!url || !url.includes("/upload/")) return null;
    return url.replace("/upload/", "/upload/pg_1,f_jpg,w_500,c_limit,q_auto/");
  }

  // Une URL ne doit jamais servir de href/src si elle ne pointe pas
  // vers du https — évite tout schéma javascript:/data: injecté.
  function isSafeUrl(url) {
    return typeof url === "string" && /^https:\/\//i.test(url);
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        if (key === "text") node.textContent = props[key];
        else if (key === "class") node.className = props[key];
        else if (key === "dataset") Object.assign(node.dataset, props[key]);
        else node.setAttribute(key, props[key]);
      });
    }
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  // -------- Carte "professionnelle" pour les formats sans aperçu --------
  function buildGenericCard(msg, r) {
    const ext = getExtension(msg.attachment_name || "");
    const meta = CATEGORY_BY_EXT[ext] || { icon: "📎", label: "Fichier" };
    const sizeText = formatFileSize(msg.attachment_size);

    const downloadUrl = isSafeUrl(r.downloadUrl)
      ? r.downloadUrl
      : (isSafeUrl(r.url) ? buildDownloadUrl(r.url, msg.attachment_name) : null);

    const card = el("div", { class: "attachment-card" }, [
      el("div", { class: "attachment-card-icon", text: meta.icon }),
      el("div", { class: "attachment-card-info" }, [
        el("div", { class: "attachment-card-label", text: meta.label }),
        el("div", { class: "attachment-card-name", text: msg.attachment_name || "Fichier" }),
        sizeText ? el("div", { class: "attachment-card-size", text: sizeText }) : null
      ]),
      el("a", {
        class: "attachment-card-btn",
        href: downloadUrl || "#",
        target: "_blank",
        rel: "noopener noreferrer",
        text: downloadUrl ? "Télécharger" : "Indisponible"
      })
    ]);

    if (!downloadUrl) {
      card.querySelector(".attachment-card-btn").addEventListener("click", (e) => e.preventDefault());
    }
    return card;
  }

  function buildPdfCard(msg, r) {
    const safeUrl = isSafeUrl(r.url) ? r.url : null;
    const safeThumb = isSafeUrl(r.previewUrl) ? r.previewUrl : (safeUrl ? pdfThumbnailUrl(safeUrl) : null);

    const wrap = el("a", {
      class: "attachment-pdf",
      href: safeUrl || "#",
      target: "_blank",
      rel: "noopener noreferrer"
    });
    if (!safeUrl) wrap.addEventListener("click", (e) => e.preventDefault());

    const img = el("img", { class: "attachment-pdf-thumb" });
    img.addEventListener("error", () => {
      img.style.display = "none";
      fallback.style.display = "flex";
    });
    if (safeThumb) img.src = safeThumb; else img.style.display = "none";

    const fallback = el("div", { class: "attachment-pdf-fallback", text: "📄 Ouvrir le PDF" });
    if (safeThumb) fallback.style.display = "none";

    const badge = el("div", { class: "attachment-pdf-badge", text: "PDF" });
    const nameEl = el("div", { class: "attachment-pdf-name", text: msg.attachment_name || "" });

    wrap.appendChild(img);
    wrap.appendChild(fallback);
    wrap.appendChild(badge);
    if (msg.attachment_name) wrap.appendChild(nameEl);
    return wrap;
  }

  // Image de la bulle : la miniature redimensionnée si elle existe
  // (pièce jointe "authenticated"), sinon l'URL publique telle quelle
  // (salon gratuit, comportement inchangé) — jamais le fichier
  // original en pleine résolution quand un allégé est disponible.
  function buildImageEl(r) {
    const src = isSafeUrl(r.previewUrl) ? r.previewUrl : (isSafeUrl(r.url) ? r.url : null);
    const img = el("img", { class: "msg-media" });
    if (src) img.src = src;
    // conserve l'URL "plein écran" pour la visionneuse (clic sur l'image)
    if (isSafeUrl(r.url)) img.dataset.fullSrc = r.url;
    return img;
  }

  function buildVideoEl(r) {
    const wrap = el("div", { class: "msg-media", dataset: { type: "video" } });
    const video = el("video", { muted: "", playsinline: "", preload: "metadata" });
    if (isSafeUrl(r.url)) {
      video.src = r.url;
      wrap.dataset.src = r.url;
    }
    wrap.appendChild(video);
    wrap.appendChild(el("span", { class: "play-overlay", text: "▶" }));
    return wrap;
  }

  function buildAudioEl(r) {
    const audio = el("audio", { controls: "" });
    if (isSafeUrl(r.url)) audio.src = r.url;
    return audio;
  }

  // Point d'entrée : construit l'élément DOM représentant la pièce
  // jointe d'un message.
  // `resolved` : undefined/null (pièce publique — on utilise
  // msg.attachment_url directement) ou { url, previewUrl, downloadUrl }
  // renvoyé par /api/attachment (POST) pour une pièce "authenticated".
  function renderAttachment(msg, resolved) {
    const r = resolved || { url: msg.attachment_url, previewUrl: null, downloadUrl: null };

    if (isSvgAttachment(msg)) return buildImageEl(r); // <img> = rendu sûr, jamais d'injection du SVG dans le DOM
    if (msg.attachment_type === "audio") return buildAudioEl(r);
    if (isPdfAttachment(msg)) return buildPdfCard(msg, r);
    if (msg.attachment_type === "image") return buildImageEl(r);
    if (msg.attachment_type === "video") return buildVideoEl(r);
    return buildGenericCard(msg, r);
  }

  function needsSignedUrl(msg) {
    return msg.attachment_url && msg.attachment_access === "authenticated";
  }

  // Regroupe en UN seul appel /api/attachment (POST) la résolution des
  // URLs signées pour tous les messages "authenticated" d'un lot
  // (chargement initial d'une conversation/d'un salon). Les pièces
  // jointes publiques n'appellent jamais cette route : leur URL est
  // utilisée directement.
  async function resolveAttachmentUrls(supabase, context, contextId, messages) {
    const map = new Map();
    const toResolve = messages.filter(needsSignedUrl);
    if (!toResolve.length) return map;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData && sessionData.session ? sessionData.session.access_token : null;
      if (!accessToken) return map;

      const resp = await fetch("/api/attachment", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + accessToken },
        body: JSON.stringify({
          context: context, // "room" | "dm"
          contextId: contextId,
          messageIds: toResolve.map((m) => m.id)
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Résolution des pièces jointes impossible");

      Object.keys(data.urls || {}).forEach((id) => {
        map.set(String(id), data.urls[id]);
      });
    } catch (err) {
      console.error("resolveAttachmentUrls:", err);
    }
    return map;
  }

  return {
    getExtension,
    isPdfAttachment,
    isSvgAttachment,
    formatFileSize,
    buildDownloadUrl,
    pdfThumbnailUrl,
    isSafeUrl,
    renderAttachment,
    needsSignedUrl,
    resolveAttachmentUrls
  };
})();
