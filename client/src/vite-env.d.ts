/// <reference types="vite/client" />

interface ImportMetaEnv {
  //Backend API base URL in production, e.g. https://your-app.up.railway.app/api 
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
