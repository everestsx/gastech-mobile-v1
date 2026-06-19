import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getCachedTranslations, syncLanguageDictionaries } from './services/language.service';

/**
 * Fallback English resources just in case the cache is completely empty and offline.
 */
const fallbackResources = {
  en: {
    translation: {
      common: {
        loading: 'Loading fallback...'
      }
    }
  }
};

function applyResourcesToI18n(resources) {
  if (!resources || typeof resources !== 'object') return;
  for (const lng of Object.keys(resources)) {
    const bundle = resources[lng]?.translation;
    if (bundle && typeof bundle === 'object') {
      i18n.addResourceBundle(lng, 'translation', bundle, true, true);
    }
  }
}

/** Reload bundled translations into the live i18n instance (e.g. after language change). */
export async function reloadI18nResources() {
  const resources = (await syncLanguageDictionaries()) || (await getCachedTranslations());
  applyResourcesToI18n(resources);
  return resources;
}

/**
 * Initialize i18next asynchronously.
 * It will pull from AsyncStorage first, and fallback if empty.
 */
export const initI18n = async (defaultLanguage = 'en') => {
  let resources = await syncLanguageDictionaries();
  if (!resources) {
    resources = (await getCachedTranslations()) || fallbackResources;
  }

  if (i18n.isInitialized) {
    applyResourcesToI18n(resources);
    await i18n.changeLanguage(defaultLanguage);
    return;
  }

  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: defaultLanguage,
      fallbackLng: 'en',
      supportedLngs: ['en', 'si', 'ta'],
      ns: ['translation'],
      defaultNS: 'translation',
      debug: false,
      interpolation: {
        escapeValue: false, // React already does escaping
      },
    });
};

export default i18n;
