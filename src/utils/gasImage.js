/**
 * Maps parsed cylinder weight (kg) from backend product names to local gas images.
 * Uses the same parsing as productDisplay (any kg in the name, e.g. 2.4 or 2.3).
 *
 * require() paths are relative to this file (src/utils → ../../assets/Gas_Image/).
 */

import { parseKgFromProductName } from './productDisplay';

const GAS_IMAGE_SOURCES = {
  '12.5': require('../../assets/Gas_Image/gas12.5k.png'),
  '37.5': require('../../assets/Gas_Image/37.5kg.png'),
  '5': require('../../assets/Gas_Image/5kg.png'),
  '2.3': require('../../assets/Gas_Image/2.3kg.png'),
};

/**
 * Get the gas cylinder image source for a product name, or null if no kg can be parsed.
 * @param {string} productName - Raw product name from backend (e.g. product_id[1] or name).
 * @returns {number|null} - require() result for Image source, or null.
 */
export function getProductImageSource(productName) {
  if (productName == null || typeof productName !== 'string') return null;
  const kg = parseKgFromProductName(productName.trim());
  if (kg == null) return null;
  if (kg < 4) return GAS_IMAGE_SOURCES['2.3'];
  if (kg < 9) return GAS_IMAGE_SOURCES['5'];
  if (kg < 20) return GAS_IMAGE_SOURCES['12.5'];
  return GAS_IMAGE_SOURCES['37.5'];
}
