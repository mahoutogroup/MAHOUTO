// =========================================================
// /api/push.js — Notifications push web (24/09/2026)
//
// Deux actions dans un seul fichier (comme attachment.js et course.js)
// pour rester à 12/12 fonctions Vercel max sur le plan Hobby :
//   POST { action: "subscribe",   endpoint, keys }         → enregistre cet appareil
//   POST { action: "send", context: "dm", conversationId, title, body, url }
//        → notifie l'AUTRE personne de cette conversation privée
//
// Portée volontairement limitée aux DM pour cette première version :
// une notification de salon toucherait potentiellement tous les
// membres d'un salon gratuit (donc tout le monde) — un vrai système
// de préférences/abonnement par salon est un chantier séparé, pas
// nécessaire pour le besoin actuel (appels, DM).
//
// Sécurité : l'action "send" vérifie en base que l'appelant fait bien
// partie de la conversation ciblée avant d'envoyer quoi que ce soit —
// impossible de spammer un utilisateur arbitraire.
// =========================================================

import webpush from "web-push";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur incomplète" });
  }

  const authorization = String(req.headers.authorization || "");
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return res.status(401).json({ error: "Utilisateur non authentifié" });
  }
  const accessToken = authorization.slice(7).trim();

  const { createClient } = await import("@supabase/supabase-js");

  // Même pattern que course.js : un client "anon" sert uniquement à
  // vérifier le jeton de l'appelant, un client "admin" séparé (clé
  // service_role) effectue ensuite les lectures/écritures privilégiées.
  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: userData, error: userError } = await supabaseAuth.auth.getUser(accessToken);
  if (userError || !userData || !userData.user) {
    return res.status(401).json({ error: "Session invalide ou expirée" });
  }
  const callerId = userData.user.id;

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "JSON invalide" });
  }

  if (body.action === "subscribe") return handleSubscribe(res, supabaseAdmin, callerId, body);
  if (body.action === "send") return handleSend(res, supabaseAdmin, callerId, body);
  return res.status(400).json({ error: "action invalide (attendu: subscribe | send)" });
}

// ---------------------------------------------------------
// Enregistre l'abonnement de CET appareil pour l'utilisateur connecté.
// ---------------------------------------------------------
async function handleSubscribe(res, supabaseAdmin, callerId, body) {
  const endpoint = String(body.endpoint || "").trim();
  const keys = body.keys || {};
  const p256dh = String(keys.p256dh || "").trim();
  const auth = String(keys.auth || "").trim();

  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: "Abonnement push incomplet" });
  }

  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .upsert(
      { user_id: callerId, endpoint, p256dh, auth },
      { onConflict: "endpoint" }
    );

  if (error) {
    console.error("push subscribe:", error);
    return res.status(500).json({ error: "Impossible d'enregistrer l'abonnement" });
  }
  return res.status(200).json({ ok: true });
}

// ---------------------------------------------------------
// Envoie une notification à l'autre participant d'une conversation
// privée — jamais à un utilisateur arbitraire choisi par l'appelant.
// ---------------------------------------------------------
async function handleSend(res, supabaseAdmin, callerId, body) {
  if (body.context !== "dm") {
    return res.status(400).json({ error: "context non supporté (seul 'dm' est géré pour l'instant)" });
  }

  const conversationId = String(body.conversationId || "").trim();
  if (!conversationId) {
    return res.status(400).json({ error: "conversationId manquant" });
  }

  const { data: conv, error: convError } = await supabaseAdmin
    .from("dm_conversations")
    .select("user_one, user_two")
    .eq("id", conversationId)
    .maybeSingle();

  if (convError || !conv) {
    return res.status(404).json({ error: "Conversation introuvable" });
  }
  if (conv.user_one !== callerId && conv.user_two !== callerId) {
    // L'appelant n'appartient pas à cette conversation — refusé.
    return res.status(403).json({ error: "Accès refusé à cette conversation" });
  }

  const recipientId = conv.user_one === callerId ? conv.user_two : conv.user_one;

  const { data: subs, error: subsError } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", recipientId);

  if (subsError) {
    console.error("push send (lecture abonnements):", subsError);
    return res.status(500).json({ error: "Impossible de lire les abonnements du destinataire" });
  }
  if (!subs || !subs.length) {
    // Le destinataire n'a activé les notifications sur aucun appareil —
    // pas une erreur, juste rien à envoyer.
    return res.status(200).json({ ok: true, sent: 0 });
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    return res.status(500).json({ error: "Clés VAPID manquantes côté serveur" });
  }
  webpush.setVapidDetails("mailto:contact@mahouto.com", vapidPublic, vapidPrivate);

  const title = String(body.title || "MAHOUTO+").trim().slice(0, 100);
  const notifBody = String(body.body || "").trim().slice(0, 200);
  const url = String(body.url || "/messages-prives.html").trim().slice(0, 300);

  const payload = JSON.stringify({ title, body: notifBody, url });

  let sent = 0;
  const staleIds = [];

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (err) {
      // 404/410 = l'abonnement n'est plus valide côté navigateur
      // (désinstallé, permission révoquée...) — on nettoie.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        staleIds.push(sub.id);
      } else {
        console.error("push send (envoi):", err && err.message);
      }
    }
  }));

  if (staleIds.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", staleIds);
  }

  return res.status(200).json({ ok: true, sent });
}
