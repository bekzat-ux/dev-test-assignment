// @rev kc-31
import { createServer, type ServerResponse } from 'node:http';
import { almatyDate, isCalendarDate } from './almaty.ts';
import { assignBranch } from './router.ts';
import { assignments, branches, orders } from './store.ts';
import type { Assignment, Branch, Order } from './types.ts';

export type DispatchData = {
  branches: Branch[];
  orders: Order[];
  assignments: Map<string, Assignment>;
};

export function createDispatchServer(data: DispatchData = { branches, orders, assignments }) {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (req.method === 'GET' && url.pathname === '/branches') {
        return send(res, 200, data.branches);
      }

      if (req.method === 'POST' && parts[0] === 'orders' && parts.length === 3 && parts[2] === 'assign') {
        const order = data.orders.find((item) => item.id === parts[1]);
        if (!order) return send(res, 404, { error: 'order_not_found' });

        const previous = data.assignments.get(order.id);
        if (previous) return send(res, 200, previous);

        const assignment = assignBranch(order, data.branches, {
          assignments: data.assignments,
          orders: data.orders,
        });
        data.assignments.set(order.id, assignment);
        return send(res, 200, assignment);
      }

      if (req.method === 'GET' && parts[0] === 'branches' && parts.length === 3 && parts[2] === 'load') {
        const date = url.searchParams.get('date');
        if (!date || !isCalendarDate(date)) return send(res, 400, { error: 'invalid_date' });

        const branch = data.branches.find((item) => item.id === parts[1]);
        if (!branch) return send(res, 404, { error: 'branch_not_found' });

        const ordersById = new Map<string, Order>();
        for (const order of data.orders) ordersById.set(order.id, order);

        let assigned = 0;
        for (const [orderId, assignment] of data.assignments) {
          if (assignment.branchId !== branch.id) continue;
          const order = ordersById.get(orderId);
          if (order && almatyDate(order.createdAt) === date) assigned += 1;
        }

        return send(res, 200, { branchId: branch.id, date, assigned, limit: branch.dailyLimit });
      }

      if (req.method === 'GET' && parts[0] === 'orders' && parts.length === 2) {
        const order = data.orders.find((item) => item.id === parts[1]);
        if (!order) return send(res, 404, { error: 'order_not_found' });
        return send(res, 200, order);
      }

      return send(res, 404, { error: 'not_found' });
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: 'internal' });
    }
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
