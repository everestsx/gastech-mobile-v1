import { callOdoo } from "./index.service";

export const getPickingBySaleOrder = (saleOrderId) =>
  callOdoo(
    "stock.picking",
    "search_read",
    [[["sale_id", "=", saleOrderId]]],
    {
      fields: ["id", "state", "move_line_ids"],
      limit: 1,
    }
  );

export const getMoveLines = (ids) =>
  callOdoo(
    "stock.move.line",
    "read",
    [ids],
    {
      fields: ["id", "product_id", "product_uom_qty", "qty_done"],
    }
  );

export const updateMoveLineQty = (id, qty) =>
  callOdoo(
    "stock.move.line",
    "write",
    [[id], { qty_done: qty }]
  );

export const validatePicking = (id) =>
  callOdoo(
    "stock.picking",
    "button_validate",
    [[id]]
  );
