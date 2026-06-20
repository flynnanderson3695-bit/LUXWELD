// Pure helpers for warranty dates & live status.

export function addYears(isoDate, years) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + Number(years));
  return d.toISOString().slice(0, 10);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compute the live warranty status for a product.
 * Returns one of:
 *   Cancelled, Awaiting Production, Ready for Installation,
 *   Incomplete, Active, Expired.
 * (instPhotoCount = number of installation photos on file.)
 */
export function warrantyStatus({ product, production, installation, warranty, instPhotoCount }) {
  if (!product) return 'Unknown';
  if (product.status === 'CANCELLED') return 'Cancelled';
  if (!production) return 'Awaiting Production';
  if (!installation) return 'Ready for Installation';
  if (!warranty || (instPhotoCount ?? 0) < 4) return 'Incomplete';
  return todayISO() <= warranty.end_date ? 'Active' : 'Expired';
}

// Gold/charcoal badge styles for the dark UI.
export function statusBadgeClass(status) {
  switch (status) {
    case 'Active': return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30';
    case 'Expired': return 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30';
    case 'Ready for Installation': return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30';
    case 'Awaiting Production': return 'bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30';
    case 'Incomplete': return 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30';
    case 'Cancelled': return 'bg-zinc-700/40 text-zinc-400 ring-1 ring-zinc-600/40 line-through';
    default: return 'bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30';
  }
}
