/**
 * Typsicherer Einstiegspunkt für die OSCAL-Versionsmatrix (GSPP-283).
 * Implementierung in oscalVersionMatrix.mjs, damit auch die Node-Build-Skripte
 * (scripts/fetch-catalog.mjs, scripts/sync-oscal-schemas.mjs) dieselbe Quelle
 * importieren können.
 */
export * from './oscalVersionMatrix.mjs';
