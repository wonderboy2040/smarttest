/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TG_TOKEN: string;
  readonly VITE_TG_CHAT_ID: string;
  readonly VITE_API_URL: string;
  readonly VITE_API_PROXY: string;
  readonly VITE_API_TOKEN: string;
  readonly VITE_TAVILY_API_KEY: string;
  readonly VITE_ENCRYPTION_KEY: string;
  readonly VITE_SECURE_PIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
