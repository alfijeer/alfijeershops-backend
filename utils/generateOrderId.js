// Human-friendly order IDs like ORD-K3F9X2 — short, unique enough in
// practice, and readable when a seller or admin is scanning a list.
function generateOrderId() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${rand}`;
}

module.exports = generateOrderId;
