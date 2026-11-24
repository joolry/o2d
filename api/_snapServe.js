// api/_snapServe.js
function fromSnapshot(snap, fn, args, user) {
  if (!snap || !snap.success) return null;

  const username = (user && user.username) ? String(user.username).toLowerCase() : '';
  const role = (user && user.role) || 'Ops';

  if (fn === 'getBootData') {
    const openCount = (snap.orders || []).filter(o => {
      const s = String(o.overallStatus || '').toLowerCase();
      return s !== 'completed' && s !== 'refunded' && s !== 'cancelled';
    }).length;
    return {
      success: true,
      user: user,
      today: snap.today,
      config: snap.config || {},
      stages: snap.stages || [],          // ← new
      openCount
    };
  }

  if (fn === 'getOrders') {
    const filter = (args && args[0]) || 'open';
    let list = snap.orders || [];

    if (filter === 'open') {
      list = list.filter(o => {
        const s = String(o.overallStatus || '').toLowerCase();
        return s !== 'completed' && s !== 'refunded' && s !== 'cancelled';
      });
    } else if (filter === 'completed') {
      list = list.filter(o => String(o.overallStatus || '').toLowerCase() === 'completed');
    } else if (filter === 'refunded') {
      list = list.filter(o => String(o.overallStatus || '').toLowerCase() === 'refunded');
    }
    // 'all' returns everything

    return { success: true, orders: list, count: list.length };
  }

  if (fn === 'getOrderDetail') {
    const orderId = args && args[0];
    const order = (snap.orders || []).find(o => String(o.orderId) === String(orderId));
    if (!order) return { success: false, error: 'Order not found' };
    const items = (snap.items || []).filter(i => String(i.orderId) === String(orderId));
    const events = (snap.events || []).filter(e => String(e.orderId) === String(orderId));
    return { success: true, order: Object.assign({}, order, { items, events }) };
  }

  if (fn === 'getStages' || fn === 'getSteps') {
    return { success: true, stages: snap.stages || [] };
  }

  if (fn === 'getConfig') {
    return { success: true, config: snap.config || {} };
  }

  if (fn === 'getSnapshot') {
    return snap;
  }

  return null; // fall through to live GAS
}
