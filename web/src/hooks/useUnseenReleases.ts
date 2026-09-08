import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { releasesApi } from "../api/releases";

/**
 * How many releases this person has not read.
 *
 * Re-checked when the route changes rather than on a timer: the count only
 * moves when they open the page, and polling a number that changes a few times
 * a year would be a request every interval for nothing.
 */
export function useUnseenReleases(): number {
  const [unseen, setUnseen] = useState(0);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    // A failure here means no dot, which is the right way to fail: an
    // indicator nobody can explain is worse than no indicator.
    void releasesApi.unseen()
      .then(({ unseen: count }) => { if (!cancelled) setUnseen(count); })
      .catch(() => { if (!cancelled) setUnseen(0); });

    return () => { cancelled = true; };
  }, [location.pathname]);

  return unseen;
}
