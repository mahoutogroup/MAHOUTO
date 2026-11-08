// =========================================================
// api/_cloudinary-og.js — validation des adresses d'images Cloudinary pour les aperçus de liens
//
// Extrait de api/produit-og.js (même code, même comportement) pour être partagé avec l'aperçu des
// salons (api/_room-og.js). Le préfixe « _ » évite que Vercel le compte comme fonction serverless
// (plafond de 12 fonctions).
// =========================================================

// Nom du « cloud » Cloudinary du projet (public) : variable Vercel si définie, sinon la valeur de config.js.
export const CLOUDINARY_CLOUD = (process.env.CLOUDINARY_CLOUD_NAME || "hefa5gqf").trim();

// Image d'aperçu 1200x630. Seule une image du compte Cloudinary du projet est utilisée ;
// toute autre origine (ou image absente) -> image par défaut MAJESTÉ (URL absolue).
// « c_pad » + « b_auto:predominant » : l'image entière est conservée (pas de rognage), qu'elle soit
// carrée, verticale ou un collage de plusieurs vues ; l'espace restant est comblé avec la couleur
// dominante de l'image. (« b_blurred » est refusé par le compte Cloudinary : erreur HTTP 400.)
// f_auto / q_auto : format et qualité automatiques (poids réduit).
//
// Une adresse enregistrée peut déjà contenir UN segment de transformation, par exemple
//   .../image/upload/f_auto,q_auto,w_1000,c_limit/v1793189115/dossier/image.png
// Il est alors REMPLACÉ par le nôtre (jamais empilé). Segment reconnu = uniquement des
// paramètres connus (f, q, w, h, c, dpr, ar, g), suivi d'un segment de version « v<chiffres> ».
// Tout segment de transformation inconnu ou multiple -> image par défaut (on ne devine pas).
const KNOWN_TRANSFORM_TOKEN = /^(?:f|q|w|h|c|dpr|ar|g)_[A-Za-z0-9:._-]+$/;

// Adresse d'image Cloudinary du projet, sans transformation : { prefix, rest } ou null.
// (validation du domaine, de /image/upload/, de « .. », des caractères interdits, et
// retrait d'UN segment de transformation connu — voir le commentaire ci-dessus.)
export function cloudinaryImageParts(first) {
  if (typeof first !== "string") return null;

  const prefix = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload/`;
  if (!first.startsWith(prefix) || first.length > 500 || /[\s"'<>]/.test(first)) return null;

  let rest = first.slice(prefix.length);
  if (!rest || rest.includes("..")) return null;

  const slash = rest.indexOf("/");
  if (slash > 0) {
    const firstSegment = rest.slice(0, slash);
    if (!/^v\d+$/.test(firstSegment)) {
      // Segment qui ressemble à une transformation (virgule, ou « xx_valeur ») ?
      if (firstSegment.includes(",") || /^[a-z]{1,4}_/.test(firstSegment)) {
        const known = firstSegment.split(",").every((t) => KNOWN_TRANSFORM_TOKEN.test(t));
        const afterSegment = rest.slice(slash + 1);
        const next = afterSegment.split("/")[0];
        if (!known || !/^v\d+$/.test(next) || !afterSegment.includes("/")) return null;
        rest = afterSegment;   // transformation existante retirée
      }
      // sinon : simple dossier (public_id sans version) -> conservé tel quel
    }
  }
  return { prefix, rest };
}
