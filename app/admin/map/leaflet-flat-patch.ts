/**
 * Silence Leaflet deprecation: _flat → L.LineUtil.isFlat.
 * leaflet-draw (and other plugins) still call L.Polyline._flat / L.LineUtil._flat;
 * patching before the map renders avoids the console warning.
 */
import L from 'leaflet'

if (typeof L !== 'undefined' && L.LineUtil?.isFlat) {
  ;(L.LineUtil as unknown as Record<string, unknown>)._flat = L.LineUtil.isFlat
  if (L.Polyline) {
    ;(L.Polyline as unknown as Record<string, unknown>)._flat = L.LineUtil.isFlat
  }
}
