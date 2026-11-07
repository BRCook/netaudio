import { api } from "../api.js";
import * as format from "../format.js";
import { useEffect } from "../lib/preact.js";
import { isEnrolled } from "./managed.js";

// Well inside the 10-second freshness window, so a single lost reply does not
// hide clock details.
const CLOCK_REFRESH_INTERVAL_MS = 3000;

// Some devices (the Behringer WING) publish clock status only when asked. Keep
// it fresh while a view that shows clock details is on screen, instead of
// letting those details disappear between manual refreshes.
export function useClockRefresh(device, requestName) {
  const managed = isEnrolled(device);
  const readable = device.online !== false && device.clock_status?.status_supported === true;
  useEffect(() => {
    if (managed || !readable || !requestName) return undefined;
    let inFlight = false;
    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      api.refreshClock(requestName).catch(() => {}).finally(() => {
        inFlight = false;
      });
    };
    if (!format.clockStatusFresh(device)) refresh();
    const timer = setInterval(refresh, CLOCK_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [requestName, managed, readable]);
}
