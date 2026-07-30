import AsyncStorage from '@react-native-async-storage/async-storage';
import enPayload from '../../translations/en.json';
import siPayload from '../../translations/si.json';
import taPayload from '../../translations/ta.json';

const TRANSLATIONS_STORAGE_KEY = '@gastech_translations';
const TRANSLATIONS_VERSION_KEY = '@gastech_translations_version';

const languageFiles = {
  en: enPayload,
  si: siPayload,
  ta: taPayload,
};

const buildPayloadFromFiles = () => ({
  version: enPayload.version || siPayload.version || taPayload.version || '1.0.0',
  translations: {
    en: { translation: enPayload.translation },
    si: { translation: siPayload.translation },
    ta: { translation: taPayload.translation },
  },
});

/** Bundled JSON is source of truth — refresh cache when version or required keys are missing. */
function isTranslationCacheStale(cached) {
  if (!cached) return true;
  const langs = ['en', 'si', 'ta'];
  for (const lng of langs) {
    const dash = cached?.[lng]?.translation?.dashboard;
    if (!dash?.pendingBackOffice) return true;
    if (!dash?.preCheckTitle) return true;
    if (!dash?.preCheckButton) return true;
    if (!dash?.postCheckButton) return true;
  }
  return false;
}

/**
 * Core function to fetch and cache translations.
 * The JSON files in /translations are now the source of truth.
 */
export const syncLanguageDictionaries = async () => {
  try {
    const payload = buildPayloadFromFiles();
    const cachedVersion = await AsyncStorage.getItem(TRANSLATIONS_VERSION_KEY);

    const cachedTranslationsRaw = await AsyncStorage.getItem(TRANSLATIONS_STORAGE_KEY);
    const cachedTranslations = cachedTranslationsRaw ? JSON.parse(cachedTranslationsRaw) : null;
    const shouldRefresh =
      !cachedVersion ||
      cachedVersion !== payload.version ||
      isTranslationCacheStale(cachedTranslations);

    if (shouldRefresh) {
      await AsyncStorage.setItem(TRANSLATIONS_STORAGE_KEY, JSON.stringify(payload.translations));
      await AsyncStorage.setItem(TRANSLATIONS_VERSION_KEY, payload.version);
      return payload.translations;
    }

    return cachedTranslations || payload.translations;
  } catch (error) {
    console.error('Error syncing language dictionaries:', error);
    const cachedTranslations = await AsyncStorage.getItem(TRANSLATIONS_STORAGE_KEY);
    return cachedTranslations ? JSON.parse(cachedTranslations) : null;
  }
};

/**
 * Retrieve the current cached dictionary.
 */
export const getCachedTranslations = async () => {
  try {
    const cached = await AsyncStorage.getItem(TRANSLATIONS_STORAGE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('Failed to get cached translations', error);
    return null;
  }
};

export const getLanguagePayload = (language) => {
  const nextLanguage = languageFiles[language] ? language : 'en';
  return languageFiles[nextLanguage];
};