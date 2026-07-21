import { Navigate, RouteObject } from "react-router-dom";

import { OrdersPage } from "./orders/OrdersPage";
import { RequireAuth } from "./security/RequireAuth";

export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/orders" replace /> },
  {
    path: "/orders",
    element: (
      <RequireAuth>
        <OrdersPage />
      </RequireAuth>
    ),
  },
];
