import { callOdoo } from "./index.service";

/**
 * Get commission plan for a specific vehicle/team
 * @param {string} teamName - The team name (license plate like "LN-7041")
 * @returns {Promise<Array>} Commission plan data
 */
export const getCommissionPlanByTeam = async (teamName) => {
  try {
    const result = await callOdoo(
      "sale.commission.plan",
      "search_read",
      [
        [["team_id.name", "=", teamName]]
      ],
      {
        fields: [
          "name",
          "team_id",
          "date_from",
          "date_to",
          "periodicity",
          "commission_amount",
          // "commission_percentage",/// todo : set this property accordingly by discussing the api team (default percentage is set to 1% for now)
          "state"
        ]
      }
    );
    console.log('[Commission API] teamName:', teamName, 'response:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('[Commission API] Error fetching commission plan:', error);
    throw error;
  }
};

/**
 * Get active commission plan for a team (current date falls within date_from and date_to)
 * @param {string} teamName - The team name (license plate)
 * @returns {Promise<Object|null>} Active commission plan or null
 */
export const getActiveCommissionPlan = async (teamName) => {
  try {
    const plans = await getCommissionPlanByTeam(teamName);

    if (!plans || plans.length === 0) {
      return null;
    }

    const today = new Date().toISOString().split('T')[0];

    // Find active plan where today is between date_from and date_to
    const activePlan = plans.find(plan => {
      const dateFrom = plan.date_from;
      const dateTo = plan.date_to;
      return dateFrom <= today && today <= dateTo && plan.state === 'active';
    });

    // If no active plan found, return the first one or most recent
    return activePlan || plans[0] || null;
  } catch (error) {
    console.error('[Commission API] Error getting active plan:', error);
    return null;
  }
};

/**
 * Calculate commission based on sales and commission percentage
 * @param {number} totalSales - Total sales amount
 * @param {number} commissionPercentage - Commission percentage (e.g., 5 for 5%)
 * @returns {number} Calculated commission amount
 */
export const calculateCommission = (totalSales, commissionPercentage) => {
  if (!totalSales || !commissionPercentage) return 0;
  return Math.round((totalSales * commissionPercentage) / 100);
};

/**
 * Calculate commission progress towards target
 * Target = All orders total × commission percentage
 * Achieved = Delivered orders total × commission percentage
 *
 * @param {number} allOrdersTotal - Total amount from all orders (for target calculation)
 * @param {number} deliveredOrdersTotal - Total amount from delivered orders (for achieved calculation)
 * @param {number} commissionPercentage - Commission percentage (e.g., 5 for 5%)
 * @returns {Object} Progress data with target, achieved, percentage and status
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
  const target = Math.round((allOrdersTotal * commissionPercentage) / 100);

  // Achieved = Delivered orders total × commission %
  const achieved = Math.round((deliveredOrdersTotal * commissionPercentage) / 100);

  // Progress percentage
  const percentage = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;

  return {
    target,
    achieved,
    percentage,
    isCompleted: percentage >= 100
  };
};

