// =========================================================
// Utilitaires de validation pour les API
// À importer et utiliser dans les fonctions serverless
// =========================================================

/**
 * Valide un montant de paiement
 * @param {number} amount - Montant en centimes (XOF)
 * @returns {number} Montant validé
 * @throws {Error} Si montant invalide
 */
export function validateAmount(amount) {
  const num = Number(amount);
  
  // Vérifier que c'est un nombre fini
  if (!Number.isFinite(num)) {
    throw new Error("Montant invalide: doit être un nombre");
  }
  
  // Vérifier que c'est positif
  if (num <= 0) {
    throw new Error("Montant invalide: doit être positif");
  }
  
  // Vérifier la limite supérieure (1 million XOF)
  if (num > 1000000) {
    throw new Error("Montant invalide: dépasse la limite maximale");
  }
  
  // Vérifier que c'est un entier (centimes)
  if (!Number.isInteger(num)) {
    throw new Error("Montant invalide: doit être un entier");
  }
  
  return num;
}

/**
 * Valide un identifiant de cours
 * @param {string} courseId - Identifiant du cours
 * @returns {string} Identifiant validé
 * @throws {Error} Si identifiant invalide
 */
export function validateCourseId(courseId) {
  if (!courseId || typeof courseId !== "string") {
    throw new Error("courseId invalide");
  }
  
  if (!/^[a-z0-9-_]+$/.test(courseId)) {
    throw new Error("courseId contient des caractères invalides");
  }
  
  if (courseId.length > 100) {
    throw new Error("courseId trop long");
  }
  
  return courseId;
}

/**
 * Valide un email
 * @param {string} email - Adresse email
 * @returns {string} Email validé
 * @throws {Error} Si email invalide
 */
export function validateEmail(email) {
  if (!email || typeof email !== "string") {
    return null; // Email optionnel
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error("Email invalide");
  }
  
  if (email.length > 255) {
    throw new Error("Email trop long");
  }
  
  return email;
}

/**
 * Valide un UUID
 * @param {string} uuid - Identifiant UUID
 * @returns {string} UUID validé
 * @throws {Error} Si UUID invalide
 */
export function validateUUID(uuid) {
  if (!uuid || typeof uuid !== "string") {
    throw new Error("UUID invalide");
  }
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    throw new Error("UUID invalide");
  }
  
  return uuid;
}

/**
 * Valide une chaîne de texte
 * @param {string} text - Texte à valider
 * @param {number} minLength - Longueur minimale
 * @param {number} maxLength - Longueur maximale
 * @returns {string} Texte validé
 * @throws {Error} Si texte invalide
 */
export function validateText(text, minLength = 1, maxLength = 1000) {
  if (!text || typeof text !== "string") {
    throw new Error("Texte invalide");
  }
  
  if (text.length < minLength) {
    throw new Error(`Texte trop court (minimum: ${minLength})`);
  }
  
  if (text.length > maxLength) {
    throw new Error(`Texte trop long (maximum: ${maxLength})`);
  }
  
  return text.trim();
}

export default {
  validateAmount,
  validateCourseId,
  validateEmail,
  validateUUID,
  validateText
};
