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

/**
 * Initialize i18next asynchronously.
 * It will pull from AsyncStorage first, and fallback if empty.
 */
export const initI18n = async (defaultLanguage = 'en') => {
  let resources = await getCachedTranslations();

  // Always attempt sync so dictionary updates reach existing installs.
  const synced = await syncLanguageDictionaries();
  if (synced) {
    resources = synced;
  }

  if (!resources) {
    resources = fallbackResources;
  }

  const supportedLngs = Object.keys(resources || fallbackResources);

  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: defaultLanguage,
      fallbackLng: 'en',
      supportedLngs,
      ns: ['translation'],
      defaultNS: 'translation',
      debug: false,
      interpolation: {
        escapeValue: false, // React already does escaping
      },
    });
};

export default i18n;
