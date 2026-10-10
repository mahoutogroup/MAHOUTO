// =========================================================
// api/_brand.js — marque d'après le nom d'hôte de la requête
//
// Même table d'hôtes que brand.js (une seule source de vérité) :
// mahouto.com, localhost, hôte inconnu -> « mahouto » ; majestepresse.com -> « majeste ».
// Le préfixe « _ » évite que Vercel le compte comme fonction serverless.
// =========================================================

import "../brand.js";

export function brandForRequest(req) {
  const raw = (req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "";
  const host = String(raw).split(",")[0].trim().split(":")[0];
  return globalThis.MAHOUTO_BRAND_BY_HOST(host);
}
