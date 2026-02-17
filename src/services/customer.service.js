// services/customer.service.js
import { callOdoo } from "./index.service";

export const getCustomers = () =>
    callOdoo(
        "res.partner",
        "search_read",
        [[["customer_rank", ">", 0]]],
        {
            fields: ["id", "name", "phone", "street", "street2", "city", "zip"],
            limit: 200,
        }
    );
