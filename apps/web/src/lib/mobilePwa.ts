/** Re-export para imports existentes; la lógica vive en `./pwa`. */
export {
  applyMobilePwaManifest,
  applyTechPwaManifest,
  isAndroidDevice,
  isIosDevice,
  isMobilePwaInstalled,
  isPwaStandalone,
  isTechPwaSession,
  registerAppServiceWorker,
  registerMobileServiceWorker,
} from './pwa'
