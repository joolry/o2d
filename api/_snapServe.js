// api/_snapServe.js — Filter snapshot for the requesting user (Order FMS)
function fromSnapshot(snap, fn, args, user) {
  if (!snap || !snap.success) return null;

  const username = (user && user.username) ? String(user.username).toLowerCase() : '';
  const role = (user && user.role) || 'Ops';

  if (fn === 'getBootData') {
    return {
      success: true,
      user: user,
      today: snap.today,
      config: snap.config || {},
      steps: snap.steps || [],
      openCount: (snap.orders || []).filter(o => {
        const s = String(o.overallStatus || '').toLowerCase();
        return s !== 'closed' && s !== 'done';
      }).length
    };
  }

  if (fn === 'getOrders') {
    const filter = (args && args[0]) || 'open';
    let list = snap.orders || [];
    if (filter === 'open') {
      list = list.filter(o => {
        const s = String(o.overallStatus || '').toLowerCase();
        return s !== 'closed' && s !== 'done';
      });
    }
    // role filter can be expanded later
    return { success: true, orders: list, count: list.length };
  }

  if (fn === 'getOrderDetail') {
    const orderId = args && args[0];
    const order = (snap.orders || []).find(o => String(o.orderId) === String(orderId));
    if (!order) return { success: false, error: 'Order not found' };
    const items = (snap.items || []).filter(i => String(i.orderId) === String(orderId));
    return { success: true, order: Object.assign({}, order, { items }) };
  }

  if (fn === 'getSteps') {
    return { success: true, steps: snap.steps || [] };
  }

  if (fn === 'getConfig') {
    return { success: true, config: snap.config || {} };
  }

  if (fn === 'getSnapshot') {
    return snap;
  }

  return null; // fall through to live GAS
}

function coverage(snap) {
  return {
    orders: (snap.orders || []).length,
    items: (snap.items || []).length,
    users: (snap.users || []).length,
    today: snap.today || null
  };
}

function normDate(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}

module.exports = { fromSnapshot, coverage, normDate };
