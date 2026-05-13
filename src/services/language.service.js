import AsyncStorage from '@react-native-async-storage/async-storage';
import enPayload from '../../translations/en.json';
import siPayload from '../../translations/si.json';
import taPayload from '../../translations/ta.json';
import { ODOO_API_KEY, ODOO_URL } from '@env';

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

const normalizeEnvString = (value) => {
  if (value == null) return '';
  let cleaned = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '').trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
};

const buildTranslationsUrl = (currentVersion) => {
  const rawUrl = normalizeEnvString(ODOO_URL);
  if (!rawUrl) return null;
  const baseUrl = rawUrl.replace(/\/jsonrpc\/?$/i, '').replace(/\/$/, '');
  let url = `${baseUrl}/api/translations`;
  if (currentVersion) {
    url += `?current_version=${encodeURIComponent(currentVersion)}`;
  }
  return url;
};

const fetchTranslationsFromApi = async (currentVersion) => {
  const url = buildTranslationsUrl(currentVersion);
  if (!url) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalizeEnvString(ODOO_API_KEY)}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn('Failed to fetch translations from API:', error?.message || error);
    return null;
  }
};

const mergeObjects = (base, incoming) => {
  if (!incoming || typeof incoming !== 'object') {
    return base;
  }

  const result = Array.isArray(base) ? [...base] : { ...base };
  Object.keys(incoming).forEach((key) => {
    const baseValue = base ? base[key] : undefined;
    const incomingValue = incoming[key];

    if (
      baseValue &&
      incomingValue &&
      typeof baseValue === 'object' &&
      typeof incomingValue === 'object' &&
      !Array.isArray(baseValue) &&
      !Array.isArray(incomingValue)
    ) {
      result[key] = mergeObjects(baseValue, incomingValue);
    } else {
      result[key] = incomingValue;
    }
  });

  return result;
};

const mergeTranslationResources = (baseResources, incomingResources) => {
  const merged = { ...(baseResources || {}) };
  Object.keys(incomingResources || {}).forEach((lang) => {
    const baseLang = merged[lang] || {};
    const incomingLang = incomingResources[lang] || {};

    merged[lang] = {
      ...baseLang,
      ...incomingLang,
      translation: mergeObjects(baseLang.translation || {}, incomingLang.translation || {}),
    };
  });

  return merged;
};

/**
 * Core function to fetch and cache translations.
 * Remote payloads are merged into the cached translations with local file fallback.
 */
export const syncLanguageDictionaries = async () => {
  try {
    const cachedVersion = await AsyncStorage.getItem(TRANSLATIONS_VERSION_KEY);
    const cachedTranslationsRaw = await AsyncStorage.getItem(TRANSLATIONS_STORAGE_KEY);
    const cachedTranslations = cachedTranslationsRaw ? JSON.parse(cachedTranslationsRaw) : {};
    const remotePayload = await fetchTranslationsFromApi(cachedVersion);
    const payload = remotePayload || buildPayloadFromFiles();
    const nextVersion = payload.version || cachedVersion || '1.0.0';
    const mergedTranslations = mergeTranslationResources(cachedTranslations, payload.translations || {});

    if (remotePayload) {
      if (!cachedVersion || cachedVersion !== payload.version) {
        await AsyncStorage.setItem(TRANSLATIONS_STORAGE_KEY, JSON.stringify(mergedTranslations));
        await AsyncStorage.setItem(TRANSLATIONS_VERSION_KEY, nextVersion);
      }
      return mergedTranslations;
    }

    if (!cachedTranslationsRaw) {
      await AsyncStorage.setItem(TRANSLATIONS_STORAGE_KEY, JSON.stringify(mergedTranslations));
      await AsyncStorage.setItem(TRANSLATIONS_VERSION_KEY, nextVersion);
      return mergedTranslations;
    }

    return cachedTranslations;
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