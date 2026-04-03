import { callOdooJson2 } from './index.service';

/**
 * Get commission achievement rates by product for a specific team
 * Uses the new JSON 2 API endpoint: /json/2/sale.commission.plan.achievement/search_read
 * @param {string} teamName - The team name (license plate like "LN-7041")
 * @returns {Promise<Array>} Commission achievement data with per-product rates
 */
export const getCommissionAchievementByTeam = async (teamName) => {
  try {
    const result = await callOdooJson2(
      "sale.commission.plan.achievement",
      "search_read",
      {
        domain: [["plan_id.team_id.name", "=", teamName]],
        fields: ["type", "product_id", "product_categ_id", "rate"]
      }
    );
    return result || [];
  } catch (error) {
    const isNetworkError =
      (error?.message || '').toLowerCase().includes('network') ||
      (error?.message || '').toLowerCase().includes('failed') ||
      error?.name === 'TypeError';
    if (__DEV__ && !isNetworkError) {
      console.warn('[Commission API] Error fetching commission achievement:', error?.message || error);
    }
    return [];
  }
};

/**
 * @param {Array} achievements - Commission achievement data from API
 */
export const buildProductRateMap = (achievements) => {
  const rateMap = {};
  (achievements || []).forEach(item => {
    const productId = Array.isArray(item.product_id) ? item.product_id[0] : item.product_id;
    if (productId && item.rate != null) {
      rateMap[productId] = item.rate;
    }
  });
  return rateMap;
};

/**
 * Get average commission rate from achievements (fallback for display)
 * @param {Array} achievements - Commission achievement data
 * @returns {number} Average rate or default
 */
export const getAverageCommissionRate = (achievements, defaultRate = 1) => {
  if (!achievements || achievements.length === 0) return defaultRate;

  const rates = achievements.map(a => a.rate).filter(r => r != null && r > 0);
  if (rates.length === 0) return defaultRate;

  const sum = rates.reduce((acc, r) => acc + r, 0);
  return sum / rates.length;
};

/**
 * Calculate commission based on order lines and per-product rates
 *
 * NOTE: Rate is a FIXED AMOUNT per item (e.g., Rs. 1 per item), NOT a percentage!
 *
 * @param {Array} orderLines - Array of order lines with product_id, product_uom_qty, and price_total
 * @param {Object} productRateMap - Map of productId -> commission rate (Rs per item)
 * @param {number} defaultRate - Default rate for products not in map (default: Rs. 1 per item)
 * @returns {number} Total commission amount
 */
export const calculateCommissionByProducts = (orderLines, productRateMap, defaultRate = 1) => {
  if (!orderLines || orderLines.length === 0) return 0;

  let totalCommission = 0;

  for (const line of orderLines) {
    const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
    const productName = Array.isArray(line.product_id) ? line.product_id[1] : 'Unknown';
    const quantity = Number(line.product_uom_qty) || Number(line.quantity) || 0;
    const rate = productRateMap[productId] ?? defaultRate;

    // Commission = quantity × rate (rate is Rs per item, NOT percentage!)
    const lineCommission = quantity * rate;
    totalCommission += lineCommission;

  }

  const finalCommission = Math.round(totalCommission * 100) / 100;

  return finalCommission;
};

/**
 * Calculate commission progress with per-product rates
 *
 * NOTE: Rate is a FIXED AMOUNT per item (e.g., Rs. 1 per item), NOT a percentage!
 *
 * Target = Sum of (each order line quantity × product commission rate in Rs)
 * Achieved = Sum of (each delivered order line quantity × product commission rate in Rs)
 *
 * @param {Array} allOrderLines - All order lines (for target calculation)
 * @param {Array} deliveredOrderLines - Delivered order lines (for achieved calculation)
 * @param {Object} productRateMap - Map of productId -> commission rate (Rs per item)
 * @param {number} defaultRate - Default rate for products not in map (default: Rs. 1 per item)
 * @returns {Object} Progress data with target, achieved, percentage, and displayRate
 */
export const calculateCommissionProgressByProducts = (
  allOrderLines,
  deliveredOrderLines,
  productRateMap,
  defaultRate = 1
) => {


  const target = calculateCommissionByProducts(allOrderLines, productRateMap, defaultRate);



  const achieved = calculateCommissionByProducts(deliveredOrderLines, productRateMap, defaultRate);


  const percentage = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
  return {
    target,
    achieved,
    percentage,
    isCompleted: percentage >= 100
  };
};


/**
 * @deprecated Use getCommissionAchievementByTeam instead
 */
export const getActiveCommissionPlan = async (teamName) => {
  try {
    const achievements = await getCommissionAchievementByTeam(teamName);

    if (!achievements || achievements.length === 0) {
      return {
        achievements: [],
        productRateMap: {},
        commission_percentage: 1, // Default Rs. 1 per item (named "percentage" for backward compatibility)
        hasData: false
      };
    }

    const productRateMap = buildProductRateMap(achievements);
    const averageRate = getAverageCommissionRate(achievements, 1);

    return {
      achievements,
      productRateMap,
      commission_percentage: averageRate, // Actually Rs per item, not percentage (kept for backward compatibility)
      hasData: true
    };
  } catch (error) {
    const isNetworkError =
      (error?.message || '').toLowerCase().includes('network') ||
      (error?.message || '').toLowerCase().includes('failed') ||
      error?.name === 'TypeError';
    if (__DEV__ && !isNetworkError) {
      console.warn('[Commission API] Error getting active plan:', error?.message || error);
    }
    return {
      achievements: [],
      productRateMap: {},
      commission_percentage: 1,
      hasData: false
    };
  }
};

/**
 * @deprecated Use calculateCommissionProgressByProducts instead
 * Calculate commission progress towards target (simple percentage-based)
 */
export const calculateCommissionProgress = (allOrdersTotal, deliveredOrdersTotal, commissionPercentage) => {
  if (!commissionPercentage || commissionPercentage <= 0) {
    return {
      target: 0,
      achieved: 0,
      percentage: 0,
      isCompleted: false
    };
  }

  // Target = All orders total × commission %
  const target = Math.round((allOrdersTotal * commissionPercentage) / 100 * 100) / 100;

  // Achieved = Delivered orders total × commission %
  const achieved = Math.round((deliveredOrdersTotal * commissionPercentage) / 100 * 100) / 100;

  // Progress percentage
  const percentage = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;

  return {
    target,
    achieved,
    percentage,
    isCompleted: percentage >= 100
  };
};

