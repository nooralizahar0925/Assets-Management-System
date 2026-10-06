import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { TOUR_STEPS } from "./tourSteps";

interface TourValue {
  start: () => void;
  hasSeen: boolean;
  userId: string | null;
  permissions: string[] | null;
}

const TourContext = createContext<TourValue>({ start: () => {}, hasSeen: true, userId: null, permissions: null });

// eslint-disable-next-line react-refresh/only-export-components
export const useTour = () => useContext(TourContext);

const seenKey = (userId: string) => `ams.tour.seen.${userId}`;

/** The one page where every element the tour points at is on screen at once. */
const TOUR_PAGE = "/assets";

/**
 * The first-run tour.
 *
 * Keyed to the user in localStorage: the spec asks for once per person, and
 * that needs no schema change and no request on every page load. The cost is
 * that a second browser shows it again, which is a mild annoyance rather than a
 * defect - and it is dismissible in one click.
 *
 * driver.js is imported only when the tour actually runs. It is 150 kB of
 * library and CSS for something most people see once, and never at all if they
 * arrive at an already-populated register.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [hasSeen, setHasSeen] = useState(true);
  const [requested, setRequested] = useState(false);
  const manualStart = useRef(false);

  useEffect(() => {
    if (!user) return;
    try {
      setHasSeen(localStorage.getItem(seenKey(user.id)) === "1");
    } catch {
      // Private browsing can throw on access. Treating it as already seen is
      // the safe failure: the alternative is a tour on every page load.
      setHasSeen(true);
    }
  }, [user]);

  const markSeen = useCallback(() => {
    setHasSeen(true);
    if (!user) return;
    try {
      localStorage.setItem(seenKey(user.id), "1");
    } catch {
      // Nothing to do - the tour simply offers itself again next session.
    }
  }, [user]);

  const drive = useCallback(() => {
    void (async () => {
      const [{ driver }] = await Promise.all([
        import("driver.js"),
        import("driver.js/dist/driver.css"),
      ]);
      driver({
        showProgress: true,
        steps: TOUR_STEPS,
        onDestroyed: markSeen,
      }).drive();
    })();
  }, [markSeen]);

  const start = useCallback(() => {
    manualStart.current = true;
    if (pathname !== TOUR_PAGE) {
      setRequested(true);
      void navigate(TOUR_PAGE);
      return;
    }
    drive();
  }, [pathname, navigate, drive]);

  useEffect(() => {
    if (!requested || pathname !== TOUR_PAGE) return;
    // Wait for the destination page to mount before measuring its tour targets.
    const timer = setTimeout(() => { setRequested(false); drive(); }, 600);
    return () => clearTimeout(timer);
  }, [requested, pathname, drive]);

  useEffect(() => {
    if (!user || hasSeen || requested || manualStart.current) return;
    if (pathname !== TOUR_PAGE) return;

    // A short delay so the register has painted: driver.js measures elements,
    // and highlighting one that is still a loading skeleton points at nothing.
    const timer = setTimeout(drive, 600);
    return () => clearTimeout(timer);
  }, [user, hasSeen, requested, pathname, drive]);

  return (
    <TourContext.Provider value={{ start, hasSeen, userId: user?.id ?? null, permissions: user?.permissions ?? null }}>
      {children}
    </TourContext.Provider>
  );
}
