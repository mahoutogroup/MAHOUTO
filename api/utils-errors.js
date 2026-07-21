// =========================================================
// Gestion centralisée des erreurs pour les API
// À importer et utiliser dans les fonctions serverless
// =========================================================

/**
 * Classe d'erreur API personnalisée
 */
export class APIError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Classe pour les erreurs de validation
 */
export class ValidationError extends APIError {
  constructor(message, details = {}) {
    super(message, 400, details);
    this.name = "ValidationError";
  }
}

/**
 * Classe pour les erreurs d'authentification
 */
export class AuthenticationError extends APIError {
  constructor(message = "Authentification requise", details = {}) {
    super(message, 401, details);
    this.name = "AuthenticationError";
  }
}

/**
 * Classe pour les erreurs d'autorisation
 */
export class AuthorizationError extends APIError {
  constructor(message = "Accès refusé", details = {}) {
    super(message, 403, details);
    this.name = "AuthorizationError";
  }
}

/**
 * Classe pour les erreurs de ressource non trouvée
 */
export class NotFoundError extends APIError {
  constructor(message = "Ressource non trouvée", details = {}) {
    super(message, 404, details);
    this.name = "NotFoundError";
  }
}

/**
 * Classe pour les erreurs de conflit
 */
export class ConflictError extends APIError {
  constructor(message = "Conflit", details = {}) {
    super(message, 409, details);
    this.name = "ConflictError";
  }
}

/**
 * Classe pour les erreurs serveur
 */
export class ServerError extends APIError {
  constructor(message = "Erreur serveur", details = {}) {
    super(message, 500, details);
    this.name = "ServerError";
  }
}

/**
 * Logger structuré pour les erreurs
 */
export function logError(level, message, extra = {}) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...extra
  };
  
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

/**
 * Gestionnaire d'erreurs pour les réponses API
 */
export function handleError(error, res) {
  // Erreur API personnalisée
  if (error instanceof APIError) {
    logError("warn", error.message, {
      statusCode: error.statusCode,
      name: error.name,
      details: error.details
    });
    
    return res.status(error.statusCode).json({
      error: error.message,
      ...(process.env.NODE_ENV === "development" && { details: error.details })
    });
  }
  
  // Erreur inconnue
  logError("error", "Erreur non gérée", {
    message: error.message,
    stack: error.stack
  });
  
  return res.status(500).json({
    error: "Une erreur s'est produite. Veuillez réessayer."
  });
}

/**
 * Wrapper pour les fonctions async avec gestion d'erreurs
 */
export function asyncHandler(fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      return handleError(error, res);
    }
  };
}

export default {
  APIError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ServerError,
  logError,
  handleError,
  asyncHandler
};
