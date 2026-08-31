import * as FileSystem from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

function stripDataUrl(raw) {
  return String(raw || '')
    .replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/i, '')
    .replace(/\s+/g, '')
    .trim();
}

function cacheDir() {
  return FileSystemLegacy.cacheDirectory || FileSystem.Paths?.cache?.uri || '';
}

async function writeBase64Png(fileName, base64) {
  const clean = stripDataUrl(base64);
  if (!clean || clean.length < 32) {
    throw new Error('QR image was empty');
  }
  const dir = cacheDir();
  if (!dir) throw new Error('No cache directory');
  const uri = `${dir}${fileName}`;

  try {
    await FileSystemLegacy.writeAsStringAsync(uri, clean, {
      encoding: FileSystemLegacy.EncodingType?.Base64 || 'base64',
    });
    return uri;
  } catch (legacyErr) {
    try {
      const file = new FileSystem.File(FileSystem.Paths.cache, fileName);
      if (file.exists) file.delete();
      file.create();
      const binary = globalThis.atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      file.write(bytes);
      if (file.uri) return file.uri;
    } catch (_) {
      /* fall through */
    }
    throw legacyErr;
  }
}

export function captureQrBase64(svgRef, timeoutMs = 8000, options = null) {
  return new Promise((resolve, reject) => {
    const svg = svgRef?.current;
    if (!svg || typeof svg.toDataURL !== 'function') {
      reject(new Error('QR not ready'));
      return;
    }
    const timer = setTimeout(() => reject(new Error('QR capture timed out')), timeoutMs);
    const onData = (data) => {
      clearTimeout(timer);
      const clean = stripDataUrl(data);
      if (!clean) {
        reject(new Error('Empty QR image'));
        return;
      }
      resolve(clean);
    };
    try {
      if (options) svg.toDataURL(onData, options);
      else svg.toDataURL(onData);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

export async function ensureGalleryWritePermission() {
  try {
    const current = await MediaLibrary.getPermissionsAsync(true);
    if (current?.granted) return true;
    const asked = await MediaLibrary.requestPermissionsAsync(true);
    return !!(
      asked?.granted ||
      asked?.accessPrivileges === 'all' ||
      asked?.accessPrivileges === 'limited'
    );
  } catch (_) {
    return false;
  }
}

export async function savePngToGallery(fileName, base64, { allowShare = true } = {}) {
  const uri = await writeBase64Png(fileName, base64);
  const allowed = await ensureGalleryWritePermission();
  if (allowed) {
    try {
      await MediaLibrary.saveToLibraryAsync(uri);
      return { uri, savedToGallery: true, fileName };
    } catch (e) {
      try {
        const asset = await MediaLibrary.createAssetAsync(uri);
        if (asset?.id) return { uri, savedToGallery: true, fileName };
      } catch (_) {
        /* share fallback */
      }
      console.warn('[qrFile] gallery save failed', e?.message || e);
    }
  }
  if (allowShare) {
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: fileName,
        UTI: 'public.png',
      });
      return { uri, savedToGallery: false, shared: true, fileName };
    }
  }
  throw new Error('Could not save the QR image');
}
