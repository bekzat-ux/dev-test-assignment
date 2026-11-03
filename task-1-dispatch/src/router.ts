// @rev kc-31
import type { Assignment, Branch, Order } from './types.ts';
import { distanceKm } from './geo.ts';
import { almatyDate } from './almaty.ts';

type AssignmentHistory = {
  assignments: ReadonlyMap<string, Assignment>;
  orders: readonly Order[];
};

export function assignBranch(
  order: Order,
  branches: Branch[],
  history: AssignmentHistory = { assignments: new Map(), orders: [] },
): Assignment {
  const own = branches.filter((b) => b.storeId === order.storeId && b.active);

  if (order.manualBranchId) {
    const manual = own.find((b) => b.id === order.manualBranchId);
    if (manual) return { orderId: order.id, branchId: manual.id, rule: 'manual' };
  }

  let selected: Branch | null = null;
  let rule: Assignment['rule'] = 'unassigned';

  if (own.length === 1) {
    selected = own[0];
    rule = 'single';
  } else {
    if (order.pickupPointId) {
      selected = own.find((b) => b.pickupPointIds.includes(order.pickupPointId!)) ?? null;
      if (selected) rule = 'pickup_point';
    }

    if (!selected) {
      const inCity = own.filter((b) => b.city === order.city);
      if (inCity.length === 1) {
        selected = inCity[0];
        rule = 'city';
      } else {
        selected = findNearest(order, inCity.length > 1 ? inCity : own);
        if (selected) rule = 'geo';
      }
    }
  }

  if (!selected) return { orderId: order.id, branchId: null, rule: 'unassigned' };

  const ordersById = new Map<string, Order>();
  for (const item of history.orders) ordersById.set(item.id, item);
  if (isFull(selected, order, history.assignments, ordersById)) {
    const available = own.filter((branch) => !isFull(branch, order, history.assignments, ordersById));
    const fallback = findNearest(order, available);
    if (!fallback) return { orderId: order.id, branchId: null, rule: 'unassigned' };
    return { orderId: order.id, branchId: fallback.id, rule: 'geo' };
  }

  return { orderId: order.id, branchId: selected.id, rule };
}

function isFull(
  branch: Branch,
  order: Order,
  assignments: ReadonlyMap<string, Assignment>,
  ordersById: ReadonlyMap<string, Order>,
): boolean {
  const date = almatyDate(order.createdAt);
  if (!date) return false;

  let assigned = 0;
  for (const [orderId, assignment] of assignments) {
    if (orderId === order.id || assignment.branchId !== branch.id) continue;
    const assignedOrder = ordersById.get(orderId);
    if (assignedOrder && almatyDate(assignedOrder.createdAt) === date) assigned += 1;
  }

  return assigned >= branch.dailyLimit;
}

function findNearest(order: Order, branches: Branch[]): Branch | null {
  if (order.lat === null || order.lon === null) return null;

  let best: Branch | null = null;
  let bestDist = Infinity;
  for (const b of branches) {
    const d = distanceKm(order.lat, order.lon, b.lat, b.lon);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}
