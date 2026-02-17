/**
 * Maps backend product names to local gas cylinder images (2.5kg, 5kg, 12.5kg, 37.5kg).
 * Products like "Gas 12.5 kg", "Gas 2.3 kg", "GAS 37.5 KG", "Gas 5 kg" (and NEW variants)
 * are matched to the respective image. Non-gas or unknown products return null.
 *
 * require() paths are relative to this file (src/utils → ../../assets/Gas_Image/).
 */

const GAS_IMAGE_SOURCES = {
  '12.5': require('../../assets/Gas_Image/gas12.5k.png'),
  '37.5': require('../../assets/Gas_Image/37.5kg.png'),
  '5': require('../../assets/Gas_Image/5kg.png'),
  '2.3': require('../../assets/Gas_Image/2.3kg.png'),
};

/**
 * Get the gas cylinder image source for a product name, or null if no match.
 * Matches: "Gas 12.5 kg", "Gas 2.3 kg", "GAS 37.5 KG", "Gas 5 kg", "NEW GAS 5 kg", etc.
 * @param {string} productName - Raw product name from backend (e.g. product_id[1] or name).
 * @returns {number|null} - require() result for Image source, or null.
 */
export function getProductImageSource(productName) {
  if (productName == null || typeof productName !== 'string') return null;
  const name = productName.trim().toLowerCase();

  // Match in order: 12.5 and 37.5 first (so "12.5" doesn't match "5"), then 5, then 2.3/2.5
  if (name.includes('12.5')) return GAS_IMAGE_SOURCES['12.5'];
  if (name.includes('37.5')) return GAS_IMAGE_SOURCES['37.5'];
  if (name.includes('5 kg') || name.includes('5kg')) return GAS_IMAGE_SOURCES['5'];
  if (name.includes('2.3') || name.includes('2.3')) return GAS_IMAGE_SOURCES['2.3'];

  return null;
}
