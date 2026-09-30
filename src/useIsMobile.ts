// The phone layout switch (<=768px), the same breakpoint as the stylesheet's
// phone block: components that render differently there (not just restyle)
// follow it live.

import { useEffect, useState } from "react";

const QUERY = "(max-width: 768px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isMobile;
}
