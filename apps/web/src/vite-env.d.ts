/// <reference types="vite/client" />

declare const __AGENTS_CORE_WEB_DEV_PROXY_AUTH__: boolean;

interface ImportMetaEnv {
  readonly VITE_AGENT_MODEL_PRESETS?: string;
  readonly VITE_AGENT_DEFAULT_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
