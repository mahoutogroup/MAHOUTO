/*
 * middleware.js — MAHOUTO+
 * -------------------------------------------------------
 * Edge Middleware, exécuté par Vercel avant toute mise en cache.
 *
 * CONTEXTE : les pages /admin/*.html sont des fichiers statiques.
 * Sur Vercel, les fichiers statiques sont traités comme des artefacts
 * immuables mis en cache globalement par le réseau Edge — les headers
 * définis dans vercel.json (Cache-Control: no-store) ne s'appliquent
 * qu'aux clients en aval (navigateurs), jamais au cache Edge lui-même
 * pour ce type de fichier (confirmé par le support Vercel).
 *
 * CORRECTIF : les fichiers admin réels vivent maintenant sous
 * /_internal/admin/ (jamais interceptés par ce middleware — cible de
 * l'appel fetch() interne ci-dessous, pas de son propre matcher). Ce
 * middleware intercepte uniquement les URLs publiques /admin/*.html,
 * va chercher le contenu réel via un fetch interne, puis renvoie une
 * réponse fraîche générée par du compute (pas par le pipeline de
 * fichiers statiques) : le cache Edge respecte alors bien no-store,
 * comme l'explique Vercel pour les réponses émises dynamiquement.
 *
 * Les liens internes (../config.js, produits.html, ../api/admin/...)
 * dans ces pages restent corrects car ils sont résolus par le
 * navigateur par rapport à l'URL publique /admin/... affichée dans la
 * barre d'adresse, jamais par rapport à l'emplacement réel du fichier
 * sur le serveur.
 *
 * -------------------------------------------------------
 * /api/dm-receipt — accusés de réception DM (WhatsApp-style)
 * -------------------------------------------------------
 * Le plan Vercel Hobby de ce projet est déjà à 12/12 Serverless
 * Functions (api/*.js, voir historique de consolidation) : ajouter un
 * nouveau fichier api/dm-receipt.js dépasserait ce plafond et casserait
 * le déploiement. L'Edge Middleware ne compte PAS dans ce quota (déjà
 * exploité ci-dessus pour le correctif de cache /admin/) — cette route
 * est donc implémentée ici, avec les mêmes garanties de sécurité
 * qu'une route serveur classique (clé service_role, identité dérivée
 * du jeton Supabase, jamais d'un ID envoyé par le navigateur).
 *
 * Utilise des appels fetch() bruts vers l'API REST/Auth de Supabase
 * (PostgREST) plutôt que le SDK @supabase/supabase-js, pour rester
 * garanti compatible avec le runtime Edge (aucune dépendance Node).
 * -------------------------------------------------------
 */

export const config = {
  matcher: ["/admin/:path*", "/api/dm-receipt"],
};

const ADMIN_FILES = new Set(["formations.html", "produits.html", "users.html"]);

export default async function middleware(request) {
  const url = new URL(request.url);

  if (url.pathname === "/api/dm-receipt") {
    return handleDmReceipt(request);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return; // laisse passer normalement (aucune autre méthode utilisée sous /admin/)
  }

  const filename = url.pathname.replace(/^\/admin\//, "");

  if (!ADMIN_FILES.has(filename)) {
    return; // chemin non prévu sous /admin/ : comportement par défaut inchangé
  }

  const originUrl = new URL(`/_internal/admin/${filename}`, url.origin);
  const originResponse = await fetch(originUrl);

  if (!originResponse.ok) {
    return originResponse;
  }

  const headers = new Headers(originResponse.headers);
  headers.set("Cache-Control", "no-store, must-revalidate");

  return new Response(originResponse.body, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers,
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/*
 * Corps attendu : { conversation_id: string, event: "delivered" | "read" }
 *
 * "delivered" : marque comme livrés (delivered_at) tous les messages de
 *   cette conversation envoyés par l'AUTRE participant et pas encore
 *   marqués comme tels. Déclenché côté client (dm-chat.html) uniquement
 *   après une confirmation réelle de réception — voir dm-chat.html pour
 *   la définition exacte retenue.
 *
 * "read" : marque comme lus (read_at) tous les messages de cette
 *   conversation envoyés par l'AUTRE participant et pas encore lus
 *   (et comble delivered_at au passage s'il ne l'était pas déjà).
 *
 * Sécurité, par construction (pas par vérification a posteriori) :
 * - l'identité de l'appelant vient exclusivement de son jeton Supabase
 *   (jamais d'un champ du corps de la requête) ;
 * - l'appelant doit être user_one OU user_two de la conversation visée,
 *   sinon 403 ;
 * - la mise à jour ne cible QUE les messages dont sender_id = l'AUTRE
 *   participant (jamais l'appelant lui-même) : il est donc
 *   structurellement impossible qu'un utilisateur marque son propre
 *   message comme lu/livré, ou qu'un tiers non participant modifie le
 *   statut d'une conversation qui ne le concerne pas ;
 * - chaque champ n'est écrit que s'il est encore NULL (progression à
 *   sens unique SENT → DELIVERED → READ, jamais de régression) ;
 * - les horodatages sont toujours générés côté serveur (now()), jamais
 *   acceptés depuis le corps de la requête.
 */
async function handleDmReceipt(request) {
  if (request.method !== "POST") {
    return json({ error: "Méthode non autorisée." }, 405);
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: "Configuration Supabase manquante sur Vercel." }, 500);
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return json({ error: "Authentification requise." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "Corps de requête invalide." }, 400);
  }

  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : null;
  const receiptEvent = body.event;
  if (!conversationId || !["delivered", "read"].includes(receiptEvent)) {
    return json({ error: "Paramètres invalides." }, 400);
  }

  // -------- 1) Identité réelle de l'appelant, dérivée du jeton --------
  let callerId;
  try {
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    if (!userResp.ok) return json({ error: "Session invalide ou expirée." }, 401);
    const userData = await userResp.json();
    callerId = userData && userData.id;
    if (!callerId) return json({ error: "Session invalide ou expirée." }, 401);
  } catch (err) {
    return json({ error: "Vérification de session impossible." }, 502);
  }

  // -------- 2) L'appelant participe-t-il réellement à cette conversation ? --------
  let conv;
  try {
    const convResp = await fetch(
      `${SUPABASE_URL}/rest/v1/dm_conversations?id=eq.${encodeURIComponent(conversationId)}&select=id,user_one,user_two`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    if (!convResp.ok) return json({ error: "Conversation introuvable." }, 404);
    const rows = await convResp.json();
    conv = rows && rows[0];
  } catch (err) {
    return json({ error: "Vérification de conversation impossible." }, 502);
  }

  if (!conv) {
    return json({ error: "Conversation introuvable." }, 404);
  }
  if (conv.user_one !== callerId && conv.user_two !== callerId) {
    return json({ error: "Vous ne participez pas à cette conversation." }, 403);
  }

  const peerId = conv.user_one === callerId ? conv.user_two : conv.user_one;
  const nowIso = new Date().toISOString();
  const restBase = `${SUPABASE_URL}/rest/v1/dm_messages`;
  const restHeaders = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  try {
    // "read" implique "delivered" : on comble delivered_at s'il manque encore,
    // sans jamais toucher aux messages déjà marqués (filtre is.null).
    if (receiptEvent === "read" || receiptEvent === "delivered") {
      const deliveredFilter =
        `conversation_id=eq.${encodeURIComponent(conversationId)}` +
        `&sender_id=eq.${encodeURIComponent(peerId)}` +
        `&delivered_at=is.null`;
      const deliveredResp = await fetch(`${restBase}?${deliveredFilter}`, {
        method: "PATCH",
        headers: restHeaders,
        body: JSON.stringify({ delivered_at: nowIso }),
      });
      if (!deliveredResp.ok) return json({ error: "Mise à jour (livré) impossible." }, 500);
    }

    if (receiptEvent === "read") {
      const readFilter =
        `conversation_id=eq.${encodeURIComponent(conversationId)}` +
        `&sender_id=eq.${encodeURIComponent(peerId)}` +
        `&read_at=is.null`;
      const readResp = await fetch(`${restBase}?${readFilter}`, {
        method: "PATCH",
        headers: restHeaders,
        body: JSON.stringify({ read_at: nowIso }),
      });
      if (!readResp.ok) return json({ error: "Mise à jour (lu) impossible." }, 500);
    }
  } catch (err) {
    return json({ error: "Mise à jour impossible." }, 502);
  }

  return json({ success: true }, 200);
}
