/// <reference types="vite/client" />

// 环境变量类型声明，让 import.meta.env.VITE_XXX 有补全
interface ImportMetaEnv {
  readonly VITE_AMAP_JS_KEY?: string
  readonly VITE_AMAP_SECURITY_CODE?: string
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    /** 高德 JS API 由 @amap/amap-jsapi-loader 挂到 window 上 */
    AMap: any
    /** JS API 2.0 安全密钥配置 */
    _AMapSecurityConfig?: { securityJsCode: string }
  }
}

export {}
