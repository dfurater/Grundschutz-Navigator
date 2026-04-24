/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IMPRESSUM_NAME?: string;
  readonly VITE_IMPRESSUM_STRASSE?: string;
  readonly VITE_IMPRESSUM_PLZ_ORT?: string;
  readonly VITE_IMPRESSUM_EMAIL?: string;
  readonly VITE_IMPRESSUM_TELEFON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
